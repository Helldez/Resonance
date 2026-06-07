/**
 * Compact binary codec for announcements (resonance-announce/v2 wire format).
 *
 * The embedding dominates the size: 768 float32 are ~3KB binary but ~15KB as
 * JSON decimal text, and the JSON form is what pushed a 1063-announcement
 * snapshot to ~15.6MB in one message. In-worker announcements keep their JS
 * shape (hex strings, number[] embedding) — the conversion to/from bytes
 * happens only at the wire boundary, so everything else (announce directory,
 * RPC events, rescan) is untouched.
 *
 * `kind` stays a string: a few bytes against a 3KB embedding buys forward
 * compatibility with future record kinds without another codec bump.
 *
 * BareKit-free on purpose so it runs under plain Node for unit tests.
 */

import c from 'compact-encoding'
import b4a from 'b4a'

export const announcementCodec = {
  preencode(state, a) {
    c.fixed32.preencode(state, b4a.from(a.outboxKey, 'hex'))
    c.fixed32.preencode(state, b4a.from(a.author, 'hex'))
    c.uint.preencode(state, a.feedIndex)
    c.string.preencode(state, a.kind)
    c.uint.preencode(state, a.createdAt)
    c.buffer.preencode(state, embeddingToBytes(a.embedding))
    c.fixed32.preencode(state, b4a.from(a.digest, 'hex'))
  },
  encode(state, a) {
    c.fixed32.encode(state, b4a.from(a.outboxKey, 'hex'))
    c.fixed32.encode(state, b4a.from(a.author, 'hex'))
    c.uint.encode(state, a.feedIndex)
    c.string.encode(state, a.kind)
    c.uint.encode(state, a.createdAt)
    c.buffer.encode(state, embeddingToBytes(a.embedding))
    c.fixed32.encode(state, b4a.from(a.digest, 'hex'))
  },
  decode(state) {
    return {
      outboxKey: b4a.toString(c.fixed32.decode(state), 'hex'),
      author: b4a.toString(c.fixed32.decode(state), 'hex'),
      feedIndex: c.uint.decode(state),
      kind: c.string.decode(state),
      createdAt: c.uint.decode(state),
      embedding: bytesToEmbedding(c.buffer.decode(state)),
      digest: b4a.toString(c.fixed32.decode(state), 'hex'),
    }
  },
}

/** Wire message payload: one bounded batch of announcements. */
export const announcementBatch = c.array(announcementCodec)

function embeddingToBytes(embedding) {
  if (embedding === null || embedding === undefined) {
    return null
  }
  // Float32Array.from allocates a fresh, aligned buffer of exactly the right size.
  return b4a.from(Float32Array.from(embedding).buffer)
}

function bytesToEmbedding(buf) {
  if (buf === null || buf.byteLength === 0 || buf.byteLength % 4 !== 0) {
    return null
  }
  // The decoded buffer is a view into the message; copy so the Float32Array
  // view is 4-byte aligned regardless of the slice's offset.
  const copy = new Uint8Array(buf.byteLength)
  copy.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  return Array.from(new Float32Array(copy.buffer))
}
