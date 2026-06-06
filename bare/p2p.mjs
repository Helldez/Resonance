/**
 * Resonance P2P Bare worker — single-room, announce-then-pull (v5).
 *
 * Responsibilities (all running inside the Bare worklet on-device):
 *   1. Open a Corestore at the app-data directory.
 *   2. Create a single writable "outbox" Hypercore — this peer's append-only
 *      feed of signed posts, responses and reactions.
 *   3. Run Hyperswarm with a connection cap, and join ONE shared 32-byte room
 *      topic (derived from the room id) as both client and server.
 *   4. On every connection, multiplex a "resonance-announce/v1" protocol over
 *      the Noise stream (Protomux). Peers exchange and gossip lightweight
 *      ANNOUNCEMENTS (author + outbox key + embedding + digest) — NOT full
 *      records, and NOT whole cores. A newly-learned announcement is emitted up
 *      to RN and forwarded to every other connection, so it reaches every peer
 *      transitively (~log₃₂(N) hops).
 *   5. When RN admits an announcement it calls `pull`; only then do we open the
 *      author's outbox core in sparse mode and download EXACTLY that one block,
 *      then stream the full record up to RN to be verified and stored.
 *
 * This inverts the v4 model (replicate every core, drain every block): ranking
 * happens on cheap summaries, and bodies are fetched only for what is kept.
 *
 * Wire protocol with the RN side: see ./rpc-frame.mjs.
 *
 * Commands accepted from RN:
 *   - 'init'      { storagePath, maxConnections, pullTimeoutMs } -> { outboxKey, noiseKey }
 *   - 'append'    { record }                      -> { feedIndex }
 *   - 'pull'      { author, feedIndex }            -> { ok: boolean }
 *   - 'joinRoom'  { roomId, topicSeed }           -> { ok: true }
 *   - 'rescan'    {}                              -> { ok: true, count }
 *   - 'shutdown'  {}                              -> { ok: true }
 *
 * Events emitted to RN:
 *   - 'announcement' { announcement }   (high-volume: every announcement seen)
 *   - 'record'       { record }         (only records we pulled, or our own)
 *   - 'presence'     { peerId, present }
 */

import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import crypto from 'bare-crypto'
import fs from 'bare-fs'

import { FramedRpc } from './rpc-frame.mjs'
import { createAnnounceState } from './announce-directory.mjs'

const { IPC } = BareKit

const DEFAULT_MAX_CONNECTIONS = 32
const DEFAULT_PULL_TIMEOUT_MS = 8000

let store = null
let outbox = null
let swarm = null
let announceDir = null
let roomDiscovery = null
let pullTimeoutMs = DEFAULT_PULL_TIMEOUT_MS
const openedCores = new Map() // hex(outboxKey) -> core (opened on demand for pulls)
const joinedDiscovery = new Set() // hex(discoveryKey) we have a swarm lookup for
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

/**
 * Build the announcement for one of our own freshly-appended records. Carries
 * the outbox CORE key (so peers can open the core to pull) alongside the author
 * Ed25519 id and feedIndex (the address), the digest, and — for posts — the
 * embedding peers rank on.
 */
function announcementFromRecord(record, feedIndex) {
  const isPost = record.body && record.body.kind === 'post'
  return {
    outboxKey: bytesToHex(outbox.key),
    author: record.author,
    feedIndex,
    kind: record.body.kind,
    createdAt: record.body.createdAt,
    embedding: isPost ? record.body.embedding : null,
    digest: record.digest,
  }
}

function onConnection(conn, info) {
  const remoteNoiseKey = bytesToHex(info.publicKey)
  console.log('[p2p] peer connected, remote noise key:', remoteNoiseKey.slice(0, 12))
  const mux = Protomux.from(conn)

  // The announce channel gossips a *list* of announcements. On open each side
  // sends the full set it knows; afterwards only freshly-learned ones are
  // forwarded (the receiver's `learn` dedup prevents loops). Announcements are
  // JSON strings — variable-size (embedding) and trivial to evolve.
  const channel = mux.createChannel({
    protocol: 'resonance-announce/v1',
    onopen: () => {
      const snapshot = announceDir.snapshot()
      if (snapshot.length > 0) {
        annMsg.send(snapshot.map((a) => JSON.stringify(a)))
      }
      console.log(`[p2p] announce open, sent ${snapshot.length} announcements`)
    },
    onclose: () => {
      unregister()
    },
    ondestroy: () => {
      unregister()
    },
  })

  const entry = {
    sendAnns: (anns) => {
      annMsg.send(anns.map((a) => JSON.stringify(a)))
    },
  }
  const unregister = announceDir.register(entry)

  const annMsg = channel.addMessage({
    encoding: c.array(c.string),
    onmessage: (items) => {
      const parsed = []
      for (const s of items) {
        try {
          parsed.push(JSON.parse(s))
        } catch (err) {
          // ignore a malformed announcement rather than dropping the batch
        }
      }
      const fresh = announceDir.learn(parsed)
      for (const a of fresh) {
        rpc.emit('announcement', { announcement: a })
      }
      announceDir.forward(entry, fresh)
      if (fresh.length > 0) {
        console.log(`[p2p] learned ${fresh.length} announcements (known=${announceDir.size})`)
      }
    },
  })

  channel.open()

  // Corestore replication shares the same Noise stream via its own Protomux
  // channels. Cores we open for pulls are auto-injected into every active
  // replication stream, so a requested block flows from whichever peer holds it.
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

async function initialize({ storagePath, maxConnections, pullTimeoutMs: pt }) {
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

  announceDir = createAnnounceState()
  if (typeof pt === 'number' && pt > 0) {
    pullTimeoutMs = pt
  }

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

  // Announce it: learn our own (so new peers get it in the snapshot) and push
  // it to every current connection. Bodies stay in the outbox until pulled.
  const ann = announcementFromRecord(finalRecord, feedIndex)
  announceDir.learn([ann])
  announceDir.forward(null, [ann])
  return { feedIndex }
}

/**
 * Open (or reuse) a peer outbox core and download EXACTLY one block — the
 * keystone of the announce-then-pull model (see scripts/spike/sparse-pull).
 *
 * Block availability: the announcer is often many hops away, so the directly
 * connected peer may not hold the block. We join the core's discovery topic so
 * peers holding it dial in, and use `findingPeers()` to keep `get(...,{wait})`
 * from resolving "not found" before that lookup drains.
 */
async function pull({ author, feedIndex }) {
  const ann = announceDir.snapshot().find(
    (a) => a.author === author && a.feedIndex === feedIndex,
  )
  if (ann === undefined) {
    console.warn(`[p2p] pull: no announcement for ${String(author).slice(0, 12)}:${feedIndex}`)
    return { ok: false }
  }
  const outboxKeyHex = ann.outboxKey
  const keyBytes = hexToBytes(outboxKeyHex)

  let core = openedCores.get(outboxKeyHex)
  if (core === undefined) {
    core = store.get({ key: keyBytes })
    await core.ready()
    openedCores.set(outboxKeyHex, core)
  }

  // Find peers that hold this core (the announcer may be non-adjacent).
  const discoveryHex = bytesToHex(core.discoveryKey)
  if (!joinedDiscovery.has(discoveryHex)) {
    joinedDiscovery.add(discoveryHex)
    swarm.join(core.discoveryKey, { server: false, client: true })
  }
  const done = core.findingPeers()
  swarm.flush().then(done, done)

  try {
    core.download({ start: feedIndex, end: feedIndex + 1 })
    const block = await core.get(feedIndex, { wait: true, timeout: pullTimeoutMs })
    const record = recordFromBlock(block, outboxKeyHex)
    if (record !== null) {
      rpc.emit('record', { record })
      console.log(`[p2p] pulled ${String(author).slice(0, 12)}:${feedIndex} kind=${record.body && record.body.kind}`)
      return { ok: true }
    }
    return { ok: false }
  } catch (err) {
    console.warn(`[p2p] pull failed ${String(author).slice(0, 12)}:${feedIndex}`, err)
    return { ok: false }
  }
}

/**
 * Re-emit every known announcement to RN. Lets a freshly-started RN side (whose
 * Tier-1 may be behind the worker's in-memory set) re-evaluate the room against
 * its current own-post profile. Cheap: announcements only, no body downloads.
 */
async function rescanAll() {
  const all = announceDir.snapshot()
  for (const a of all) {
    rpc.emit('announcement', { announcement: a })
  }
  console.log(`[p2p] rescan re-emitted ${all.length} announcements`)
  return { ok: true, count: all.length }
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
  announceDir = null
  openedCores.clear()
  joinedDiscovery.clear()
  return { ok: true }
}

rpc = new FramedRpc(IPC, async (method, params) => {
  switch (method) {
    case 'init':
      return initialize(params)
    case 'append':
      return append(params)
    case 'pull':
      return pull(params)
    case 'joinRoom':
      return joinRoom(params)
    case 'rescan':
      return rescanAll()
    case 'shutdown':
      return shutdown()
    default:
      throw new Error(`unknown method: ${method}`)
  }
})

console.log('[p2p] Resonance P2P worker booted (single-room, announce-then-pull)')
