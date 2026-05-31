/**
 * Single-room directory gossip — the state manager behind the conf-9
 * "Keet model" global convergence.
 *
 * In the single shared room every peer keeps its own append-only outbox
 * Hypercore. Hyperswarm only connects a node to at most `maxConnections`
 * neighbours, so direct connections alone would replicate just those
 * neighbours' outboxes (1 hop). To make every post reach every peer we
 * gossip the *set of known outbox keys*: when a peer learns a new key it
 * forwards it to all its other connections, so keys (and therefore cores)
 * propagate transitively across the swarm in ~log₃₂(N) hops.
 *
 * This module is intentionally transport-agnostic and dependency-free: it
 * only tracks which keys are known and which channels to forward to. The
 * Protomux wiring and the actual Corestore replication live in `p2p.mjs`,
 * which owns the Holepunch objects. Keeping the bookkeeping pure makes the
 * convergence logic easy to reason about and test.
 *
 * Keys are handled as lowercase hex strings; the caller converts to/from the
 * 32-byte buffers the wire encoding expects.
 */

export function createDirectoryState(ownKeyHex) {
  const known = new Set([ownKeyHex]);
  /** @type {Set<{ sendKeys: (hexKeys: string[]) => void }>} */
  const channels = new Set();

  return {
    /** All outbox keys this node currently knows (including its own). */
    snapshot() {
      return [...known];
    },

    /** Register a directory channel; returns an unregister function. */
    register(channel) {
      channels.add(channel);
      return () => {
        channels.delete(channel);
      };
    },

    /**
     * Record incoming keys, returning only the ones that were previously
     * unknown (so the caller can replicate exactly the new cores once).
     */
    learn(hexKeys) {
      const fresh = [];
      for (const h of hexKeys) {
        if (!known.has(h)) {
          known.add(h);
          fresh.push(h);
        }
      }
      return fresh;
    },

    /**
     * Forward freshly-learned keys to every channel except the one they
     * arrived on. Idempotent at the receiver thanks to `learn`'s guard, so
     * this cannot loop forever.
     */
    forward(originChannel, hexKeys) {
      if (hexKeys.length === 0) {
        return;
      }
      for (const ch of channels) {
        if (ch === originChannel) {
          continue;
        }
        ch.sendKeys(hexKeys);
      }
    },

    /** Number of registered channels — used only for diagnostics. */
    get channelCount() {
      return channels.size;
    },
  };
}
