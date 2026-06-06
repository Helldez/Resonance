/**
 * Announce-then-pull directory gossip — the state manager behind the
 * single-room global convergence, v5.
 *
 * Replaces the v4 key-directory (`room-directory.mjs`). Instead of gossiping
 * the SET of outbox keys (which made every node replicate every core), this
 * gossips the SET of lightweight ANNOUNCEMENTS. When a peer learns a new
 * announcement it forwards it to its other connections, so announcements
 * propagate transitively across the swarm in ~log₃₂(N) hops — but the heavy
 * record bodies are pulled on demand, only for the records a node admits.
 *
 * Pure and transport-agnostic: it tracks which announcements are known (keyed
 * by `<author>:<feedIndex>`) and which channels to forward to. The Protomux
 * wiring and the sparse pulls live in `p2p.mjs`. Keeping the bookkeeping pure
 * makes the convergence logic easy to reason about and test.
 *
 * An announcement is a plain object: { author, feedIndex, kind, createdAt,
 * embedding (number[]|null), digest (hex) }. This module never inspects the
 * fields beyond `author`/`feedIndex` (the dedup key).
 */

function addressOf(ann) {
  return `${ann.author}:${ann.feedIndex}`
}

export function createAnnounceState() {
  /** @type {Map<string, object>} address -> announcement */
  const known = new Map()
  /** @type {Set<{ sendAnns: (anns: object[]) => void }>} */
  const channels = new Set()

  return {
    /** Every announcement this node currently knows. */
    snapshot() {
      return [...known.values()]
    },

    /** Register a directory channel; returns an unregister function. */
    register(channel) {
      channels.add(channel)
      return () => {
        channels.delete(channel)
      }
    },

    /**
     * Record incoming announcements, returning only the ones previously
     * unknown (so the caller emits + forwards each exactly once). Dedup is by
     * address, so a re-gossip of a known announcement is dropped — this also
     * stops forwarding loops.
     */
    learn(anns) {
      const fresh = []
      for (const a of anns) {
        const address = addressOf(a)
        if (!known.has(address)) {
          known.set(address, a)
          fresh.push(a)
        }
      }
      return fresh
    },

    /** Forward freshly-learned announcements to every channel except origin. */
    forward(originChannel, anns) {
      if (anns.length === 0) {
        return
      }
      for (const ch of channels) {
        if (ch === originChannel) {
          continue
        }
        ch.sendAnns(anns)
      }
    },

    /** Number of registered channels — diagnostics only. */
    get channelCount() {
      return channels.size
    },

    /** Number of announcements known — diagnostics only. */
    get size() {
      return known.size
    },
  }
}
