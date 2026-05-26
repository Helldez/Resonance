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
  let cursor = 0
  core.on('append', async () => {
    while (cursor < core.length) {
      try {
        const block = await core.get(cursor, { wait: true, timeout: 30000 })
        const record = recordFromBlock(block, peerId)
        if (record !== null) {
          rpc.emit('record', { record })
        }
      } catch (err) {
        console.warn('[p2p] read error', err)
      }
      cursor++
    }
  })
}

async function onConnection(conn, info) {
  const mux = Protomux.from(conn)

  const dir = mux.createChannel({
    protocol: 'resonance-directory/v1',
    onopen: () => {
      dirMsg.send({ outboxKey: outbox.key })
    },
    onclose: () => {},
    ondestroy: () => {}
  })

  const dirMsg = dir.addMessage({
    encoding: c.struct({ outboxKey: c.fixed32 }),
    onmessage: async ({ outboxKey }) => {
      const peerId = bytesToHex(outboxKey)
      if (knownRemoteCores.has(peerId)) return
      const remote = store.get({ key: outboxKey })
      try {
        await watchCore(remote)
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

async function initialize({ storagePath }) {
  if (store !== null) {
    return { outboxKey: bytesToHex(outbox.key) }
  }
  store = new Corestore(storagePath)
  outbox = store.get({ name: 'outbox' })
  await outbox.ready()

  swarm = new Hyperswarm()
  swarm.on('connection', onConnection)

  return { outboxKey: bytesToHex(outbox.key) }
}

async function append({ record }) {
  const json = JSON.stringify(record)
  const feedIndex = await outbox.append(b4a.from(json, 'utf8'))
  return { feedIndex }
}

async function joinBucket({ bucketId, topicSeed }) {
  if (joinedBuckets.has(bucketId)) {
    return { ok: true }
  }
  const topic = topicForBucket(topicSeed, bucketId)
  const discovery = swarm.join(topic, { server: true, client: true })
  joinedBuckets.set(bucketId, { discovery, topic })
  await discovery.flushed()
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
    case 'leaveBucket':
      return leaveBucket(params)
    case 'shutdown':
      return shutdown()
    default:
      throw new Error(`unknown method: ${method}`)
  }
})

console.log('[p2p] Resonance P2P worker booted')
