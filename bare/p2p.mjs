/**
 * Resonance P2P Bare worker.
 *
 * Responsibilities (all running inside the Bare worklet on-device):
 *   1. Open a Corestore at the app-data directory.
 *   2. Create a single writable "outbox" Hypercore — this peer's append-
 *      only feed of signed posts and responses.
 *   3. Run Hyperswarm. Join/leave 32-byte topic hashes derived from
 *      semantic bucket ids on demand from the RN side.
 *   4. On every peer connection, multiplex a tiny "resonance/directory"
 *      protocol over the Noise stream (Protomux) so peers can exchange
 *      outbox keys, then let Corestore replicate everything else.
 *   5. Stream every new remote record up to the RN side via framed JSON
 *      IPC ('record' event). The RN side verifies Ed25519 signatures and
 *      decides what to do with each record.
 *
 * Wire protocol with the RN side: see ./rpc-frame.mjs.
 *
 * Commands accepted from RN:
 *   - 'init'         { storagePath }            -> { outboxKey }
 *   - 'append'       { record }                 -> { feedIndex }
 *   - 'joinBucket'   { bucketId, topicSeed }    -> { ok: true }
 *   - 'leaveBucket'  { bucketId }               -> { ok: true }
 *   - 'shutdown'     {}                         -> { ok: true }
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

const { IPC } = BareKit

let store = null
let outbox = null
let swarm = null
const joinedBuckets = new Map() // bucketId -> { discovery, topic }
const knownRemoteCores = new Map() // hex(outboxKey) -> core
let rpc

function bytesToHex(buf) {
  return b4a.toString(buf, 'hex')
}

function hexToBytes(hex) {
  return b4a.from(hex, 'hex')
}

function topicForBucket(topicSeed, bucketId) {
  // 32-byte topic = sha256(topicSeed || bucketId).
  const h = crypto.createHash('sha256')
  h.update(b4a.from(topicSeed, 'utf8'))
  h.update(b4a.from(bucketId, 'utf8'))
  return h.digest()
}

function recordFromBlock(block, peerId) {
  // Wire-format records are JSON with hex-encoded bytes for digest and
  // signature, plus base64 for the embedding (in PostBody). We just pass
  // the parsed object straight up to RN; RN re-parses canonically and
  // verifies the signature against `author`.
  try {
    const parsed = JSON.parse(b4a.toString(block, 'utf8'))
    return parsed
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

  // Force a metadata refresh so the local replica learns the writer's current length.
  try {
    await core.update({ wait: false })
    console.log(`[p2p] core.update() done peer=${peerId.slice(0, 12)} length=${core.length}`)
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
        console.log(`[p2p] block read peer=${peerId.slice(0, 12)} index=${cursor} bytes=${block.length}`)
        const record = recordFromBlock(block, peerId)
        if (record !== null) {
          rpc.emit('record', { record })
          console.log(`[p2p] emitted record peer=${peerId.slice(0, 12)} index=${cursor} kind=${record.body && record.body.kind}`)
        } else {
          console.warn(`[p2p] recordFromBlock returned null index=${cursor}`)
        }
      } catch (err) {
        console.warn(`[p2p] read error peer=${peerId.slice(0, 12)} index=${cursor}`, err)
      }
      cursor++
    }
  }

  // Backfill any blocks that exist before our subscription.
  await drain('initial')

  core.on('append', () => {
    void drain('append')
  })
}

async function onConnection(conn, info) {
  const remoteNoiseKey = bytesToHex(info.publicKey)
  console.log('[p2p] peer connected, remote noise key:', remoteNoiseKey.slice(0, 12))
  const mux = Protomux.from(conn)

  // Single 32-byte message = the peer's outbox Hypercore key. compact-encoding
  // doesn't expose `struct`; for a single fixed field we use `c.fixed32`
  // directly and pass the raw buffer.
  const dir = mux.createChannel({
    protocol: 'resonance-directory/v1',
    onopen: () => {
      console.log('[p2p] directory channel open, sending our outbox key')
      dirMsg.send(outbox.key)
    },
    onclose: () => {},
    ondestroy: () => {}
  })

  const dirMsg = dir.addMessage({
    encoding: c.fixed32,
    onmessage: async (outboxKey) => {
      const peerId = bytesToHex(outboxKey)
      console.log('[p2p] received remote outbox key:', peerId.slice(0, 12))
      // Emit the (outboxKey ↔ noiseKey) pairing so the RN side can persist
      // it and call joinPeer on future boots. Sticky peers survive bucket
      // changes — see docs/SEMANTIC_ROUTING.md §10 (sticky peers).
      rpc.emit('peerNoise', { peerId, noiseKey: remoteNoiseKey })
      if (knownRemoteCores.has(peerId)) return
      const remote = store.get({ key: outboxKey })
      try {
        await watchCore(remote)
        console.log('[p2p] now replicating remote core:', peerId.slice(0, 12))
        rpc.emit('presence', { peerId, present: true })
      } catch (err) {
        console.warn('[p2p] failed to track remote core', err)
      }
    }
  })

  dir.open()

  // Corestore replication shares the same Noise stream — Corestore uses
  // its own Protomux channels on top, so we coexist cleanly.
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

async function initialize({ storagePath }) {
  if (store !== null) {
    return { outboxKey: bytesToHex(outbox.key) }
  }
  store = new Corestore(storagePath)
  outbox = store.get({ name: 'outbox' })
  await outbox.ready()
  console.log(`[p2p] initialized; outbox key=${bytesToHex(outbox.key).slice(0, 12)} length=${outbox.length}`)

  // Persisted Hyperswarm keypair → stable Noise identity across restarts.
  // Required for sticky peers: other devices store our noise key and call
  // joinPeer on it to re-establish direct DHT connections regardless of
  // which bucket either of us is currently in.
  const existing = await loadOrCreateSwarmKeyPair(storagePath)
  if (existing !== null) {
    swarm = new Hyperswarm({ keyPair: existing })
    console.log(`[p2p] swarm restored with persisted noise key=${bytesToHex(existing.publicKey).slice(0, 12)}`)
  } else {
    swarm = new Hyperswarm()
    try {
      await persistSwarmKeyPair(storagePath, swarm.keyPair)
      console.log(`[p2p] swarm created with new noise key=${bytesToHex(swarm.keyPair.publicKey).slice(0, 12)} (persisted)`)
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
  // index. Pre-compute the index from the current length, stamp it onto the
  // record so peers receive the real feedIndex, then append.
  const feedIndex = outbox.length
  const finalRecord = { ...record, feedIndex }
  const json = JSON.stringify(finalRecord)
  const result = await outbox.append(b4a.from(json, 'utf8'))
  console.log(`[p2p] own outbox append feedIndex=${feedIndex} newLength=${result.length} kind=${finalRecord.body && finalRecord.body.kind} bytes=${json.length}`)
  return { feedIndex }
}

async function joinBucket({ bucketId, topicSeed }) {
  if (joinedBuckets.has(bucketId)) {
    console.log(`[p2p] joinBucket already joined bucket=${bucketId}`)
    return { ok: true }
  }
  const topic = topicForBucket(topicSeed, bucketId)
  console.log(`[p2p] joining bucket=${bucketId} topic=${bytesToHex(topic).slice(0, 16)}`)
  const discovery = swarm.join(topic, { server: true, client: true })
  joinedBuckets.set(bucketId, { discovery, topic })
  await discovery.flushed()
  console.log(`[p2p] joined bucket=${bucketId} (announce flushed to DHT)`)
  return { ok: true }
}

async function joinPeer({ noiseKey }) {
  if (swarm === null) {
    throw new Error('swarm not initialized')
  }
  const key = b4a.from(noiseKey, 'hex')
  if (key.byteLength !== 32) {
    throw new Error(`joinPeer: noiseKey must be 32 bytes hex, got ${key.byteLength}`)
  }
  swarm.joinPeer(key)
  console.log(`[p2p] joinPeer noise=${noiseKey.slice(0, 12)}`)
  return { ok: true }
}

async function leaveBucket({ bucketId }) {
  const entry = joinedBuckets.get(bucketId)
  if (entry === undefined) {
    return { ok: true }
  }
  await entry.discovery.destroy()
  joinedBuckets.delete(bucketId)
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
  return { ok: true }
}

rpc = new FramedRpc(IPC, async (method, params) => {
  switch (method) {
    case 'init':
      return initialize(params)
    case 'append':
      return append(params)
    case 'joinBucket':
      return joinBucket(params)
    case 'joinPeer':
      return joinPeer(params)
    case 'leaveBucket':
      return leaveBucket(params)
    case 'shutdown':
      return shutdown()
    default:
      throw new Error(`unknown method: ${method}`)
  }
})

console.log('[p2p] Resonance P2P worker booted')
