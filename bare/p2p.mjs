/**
 * Resonance P2P Bare worker — single-room ("Keet model", conf 9).
 *
 * Responsibilities (all running inside the Bare worklet on-device):
 *   1. Open a Corestore at the app-data directory.
 *   2. Create a single writable "outbox" Hypercore — this peer's append-
 *      only feed of signed posts and responses.
 *   3. Run Hyperswarm with a connection cap, and join ONE shared 32-byte
 *      room topic (derived from the room id) as both client and server.
 *   4. On every peer connection, multiplex a "resonance-directory/v2"
 *      protocol over the Noise stream (Protomux). Peers exchange and gossip
 *      the *set of known outbox keys*: a newly-learned key is replicated and
 *      forwarded to every other connection, so every post reaches every peer
 *      transitively (~log₃₂(N) hops). Corestore replicates the cores.
 *   5. Stream every new remote record up to the RN side via framed JSON
 *      IPC ('record' event). The RN side verifies Ed25519 signatures and
 *      decides what to do with each record.
 *
 * Wire protocol with the RN side: see ./rpc-frame.mjs.
 *
 * Commands accepted from RN:
 *   - 'init'      { storagePath, maxConnections } -> { outboxKey, noiseKey }
 *   - 'append'    { record }                      -> { feedIndex }
 *   - 'joinRoom'  { roomId, topicSeed }           -> { ok: true }
 *   - 'shutdown'  {}                              -> { ok: true }
 *
 * Events emitted to RN:
 *   - 'record'   { record }
 *   - 'presence' { peerId, present }
 */

import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import crypto from 'bare-crypto'
import fs from 'bare-fs'

import { FramedRpc } from './rpc-frame.mjs'
import { createDirectoryState } from './room-directory.mjs'

const { IPC } = BareKit

const DEFAULT_MAX_CONNECTIONS = 32

let store = null
let outbox = null
let swarm = null
let directory = null
let roomDiscovery = null
const knownRemoteCores = new Map() // hex(outboxKey) -> core
let rpc

function bytesToHex(buf) {
  return b4a.toString(buf, 'hex')
}

function hexToBytes(hex) {
  return b4a.from(hex, 'hex')
}

function topicForRoom(topicSeed, roomId) {
  // 32-byte topic = sha256(topicSeed || roomId).
  const h = crypto.createHash('sha256')
  h.update(b4a.from(topicSeed, 'utf8'))
  h.update(b4a.from(roomId, 'utf8'))
  return h.digest()
}

function recordFromBlock(block, peerId) {
  // Wire-format records are JSON with hex-encoded bytes for digest and
  // signature, plus a number[] for the embedding. We pass the parsed object
  // straight up to RN; RN re-parses canonically and verifies the signature.
  try {
    return JSON.parse(b4a.toString(block, 'utf8'))
  } catch (err) {
    console.warn('[p2p] failed to parse block from', peerId, err)
    return null
  }
}

async function watchCore(core) {
  await core.ready()
  const peerId = bytesToHex(core.key)
  knownRemoteCores.set(peerId, core)
  console.log(`[p2p] watchCore start peer=${peerId.slice(0, 12)} length=${core.length}`)

  try {
    await core.update({ wait: false })
  } catch (err) {
    console.warn('[p2p] core.update failed', err)
  }

  let cursor = 0
  const drain = async (reason) => {
    const length = core.length
    if (length <= cursor) return
    console.log(`[p2p] drain peer=${peerId.slice(0, 12)} reason=${reason} cursor=${cursor} length=${length}`)
    while (cursor < length) {
      try {
        const block = await core.get(cursor, { wait: true, timeout: 30000 })
        const record = recordFromBlock(block, peerId)
        if (record !== null) {
          rpc.emit('record', { record })
        }
      } catch (err) {
        console.warn(`[p2p] read error peer=${peerId.slice(0, 12)} index=${cursor}`, err)
      }
      cursor++
    }
  }

  await drain('initial')
  core.on('append', () => {
    void drain('append')
  })
}

/**
 * Begin replicating a peer outbox identified by its 32-byte key. Cores
 * opened here are auto-injected by Corestore into every active replication
 * stream, so blocks flow without re-dialing. Idempotent per key.
 */
async function trackRemoteCoreByKey(keyBytes) {
  const peerId = bytesToHex(keyBytes)
  if (knownRemoteCores.has(peerId)) {
    return
  }
  const remote = store.get({ key: keyBytes })
  try {
    await watchCore(remote)
    rpc.emit('presence', { peerId, present: true })
  } catch (err) {
    console.warn('[p2p] failed to track remote core', peerId.slice(0, 12), err)
  }
}

function onConnection(conn, info) {
  const remoteNoiseKey = bytesToHex(info.publicKey)
  console.log('[p2p] peer connected, remote noise key:', remoteNoiseKey.slice(0, 12))
  const mux = Protomux.from(conn)

  // The directory channel gossips a *list* of 32-byte outbox keys. On open
  // each side sends the full set it knows; afterwards only freshly-learned
  // keys are forwarded (the receiver's `learn` guard prevents loops).
  const dir = mux.createChannel({
    protocol: 'resonance-directory/v2',
    onopen: () => {
      const snapshot = directory.snapshot()
      dirMsg.send(snapshot.map(hexToBytes))
      console.log(`[p2p] directory open, sent ${snapshot.length} keys`)
    },
    onclose: () => {
      unregister()
    },
    ondestroy: () => {
      unregister()
    },
  })

  const entry = {
    sendKeys: (hexKeys) => {
      dirMsg.send(hexKeys.map(hexToBytes))
    },
  }
  const unregister = directory.register(entry)

  const dirMsg = dir.addMessage({
    encoding: c.array(c.fixed32),
    onmessage: async (keys) => {
      const hexKeys = keys.map(bytesToHex)
      const fresh = directory.learn(hexKeys)
      for (const h of fresh) {
        await trackRemoteCoreByKey(hexToBytes(h))
      }
      directory.forward(entry, fresh)
      if (fresh.length > 0) {
        console.log(`[p2p] learned ${fresh.length} new keys (known=${directory.snapshot().length})`)
      }
    },
  })

  dir.open()

  // Corestore replication shares the same Noise stream via its own Protomux
  // channels, so it coexists cleanly with the directory channel.
  store.replicate(conn)
}

async function loadOrCreateSwarmKeyPair(storagePath) {
  const path = storagePath + '/swarm-keypair.json'
  try {
    const json = await fs.promises.readFile(path, 'utf8')
    const obj = JSON.parse(json)
    return {
      publicKey: b4a.from(obj.publicKey, 'hex'),
      secretKey: b4a.from(obj.secretKey, 'hex'),
    }
  } catch (err) {
    return null
  }
}

async function persistSwarmKeyPair(storagePath, kp) {
  const path = storagePath + '/swarm-keypair.json'
  const json = JSON.stringify({
    publicKey: bytesToHex(kp.publicKey),
    secretKey: bytesToHex(kp.secretKey),
  })
  await fs.promises.writeFile(path, json, 'utf8')
}

async function initialize({ storagePath, maxConnections }) {
  if (store !== null) {
    return {
      outboxKey: bytesToHex(outbox.key),
      noiseKey: bytesToHex(swarm.keyPair.publicKey),
    }
  }
  store = new Corestore(storagePath)
  outbox = store.get({ name: 'outbox' })
  await outbox.ready()
  console.log(`[p2p] initialized; outbox key=${bytesToHex(outbox.key).slice(0, 12)} length=${outbox.length}`)

  directory = createDirectoryState(bytesToHex(outbox.key))

  const maxPeers =
    typeof maxConnections === 'number' && maxConnections > 0
      ? maxConnections
      : DEFAULT_MAX_CONNECTIONS

  // Persisted Hyperswarm keypair → stable Noise identity across restarts.
  const existing = await loadOrCreateSwarmKeyPair(storagePath)
  if (existing !== null) {
    swarm = new Hyperswarm({ keyPair: existing, maxPeers })
    console.log(`[p2p] swarm restored noise key=${bytesToHex(existing.publicKey).slice(0, 12)} maxPeers=${maxPeers}`)
  } else {
    swarm = new Hyperswarm({ maxPeers })
    try {
      await persistSwarmKeyPair(storagePath, swarm.keyPair)
      console.log(`[p2p] swarm created noise key=${bytesToHex(swarm.keyPair.publicKey).slice(0, 12)} maxPeers=${maxPeers} (persisted)`)
    } catch (err) {
      console.warn('[p2p] failed to persist swarm keypair', err)
    }
  }
  swarm.on('connection', onConnection)
  swarm.on('update', () => {
    console.log(`[p2p] swarm update: connecting=${swarm.connecting} connections=${swarm.connections.size}`)
  })

  return {
    outboxKey: bytesToHex(outbox.key),
    noiseKey: bytesToHex(swarm.keyPair.publicKey),
  }
}

async function append({ record }) {
  // outbox.append() returns { length, byteLength } in Hypercore 10+, not the
  // index. Pre-compute the index from the current length and stamp it onto
  // the record so peers receive the real feedIndex.
  const feedIndex = outbox.length
  const finalRecord = { ...record, feedIndex }
  const json = JSON.stringify(finalRecord)
  const result = await outbox.append(b4a.from(json, 'utf8'))
  console.log(`[p2p] own outbox append feedIndex=${feedIndex} newLength=${result.length} kind=${finalRecord.body && finalRecord.body.kind}`)
  return { feedIndex }
}

async function joinRoom({ roomId, topicSeed }) {
  if (roomDiscovery !== null) {
    console.log('[p2p] joinRoom already joined')
    return { ok: true }
  }
  const topic = topicForRoom(topicSeed, roomId)
  console.log(`[p2p] joining room=${roomId} topic=${bytesToHex(topic).slice(0, 16)}`)
  roomDiscovery = swarm.join(topic, { server: true, client: true })
  await roomDiscovery.flushed()
  console.log(`[p2p] joined room=${roomId} (announce flushed to DHT)`)
  return { ok: true }
}

async function shutdown() {
  if (swarm !== null) {
    await swarm.destroy()
    swarm = null
  }
  if (store !== null) {
    await store.close()
    store = null
    outbox = null
  }
  roomDiscovery = null
  directory = null
  return { ok: true }
}

rpc = new FramedRpc(IPC, async (method, params) => {
  switch (method) {
    case 'init':
      return initialize(params)
    case 'append':
      return append(params)
    case 'joinRoom':
      return joinRoom(params)
    case 'shutdown':
      return shutdown()
    default:
      throw new Error(`unknown method: ${method}`)
  }
})

console.log('[p2p] Resonance P2P worker booted (single-room)')
