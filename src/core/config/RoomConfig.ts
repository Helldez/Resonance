/**
 * Single-room ("Keet model") networking parameters — ResonanceSim conf 9.
 *
 * The whole app converges on ONE shared P2P room: every node joins a single
 * Hyperswarm topic, and peer outbox keys gossip transitively so every post
 * eventually reaches every peer (~log₃₂(N) hops). There are no semantic
 * buckets, no DHT routing table, and no sticky peers — routing is delegated
 * to Hyperswarm peer discovery plus the directory-gossip protocol in
 * `bare/room-directory.mjs`.
 *
 * All conf-9 knobs live here so nothing is hard-coded in the worker or the
 * UI. Changing `topicPrefix` or `roomId` partitions the network.
 */
export const RoomConfig = {
  /**
   * The one shared room. The Hyperswarm topic is derived as
   * `sha256(topicPrefix || roomId)`; every peer computes the same value and
   * therefore lands in the same swarm.
   */
  roomId: 'global',

  /**
   * Topic namespace prefix. Hyperswarm topics are 32-byte values; we derive
   * ours as `sha256(topicPrefix || roomId)` so we never collide with another
   * app sharing the public DHT.
   *
   * Version bump history:
   *   v1 → v2 — EmbeddingGemma 256-dim → bge-m3 1024-dim + multi-table LSH.
   *   v2 → v3 — single-room Keet model (conf 9): LSH routing removed, one
   *             shared room with directory gossip, and the embedding space
   *             reverts to EmbeddingGemma-300M 768-dim (clustering prompt).
   *             Peers and record signatures are incompatible across this
   *             boundary, so the prefix bump isolates them.
   *   v3 → v4 — new signed `reaction` RecordKind (like/insightful/agree/curious).
   *             The wire/codec gains a third body variant; v4 isolates peers on
   *             the old format. (Agent provenance fields will land in a later
   *             bump once the agent layer exists.)
   */
  topicPrefix: 'resonance/v4/room/',

  /**
   * Maximum concurrent Hyperswarm connections per node. Mirrors the conf-9
   * model's "max 32 connections per node": discovery fans out to at most
   * this many peers, and gossip propagation gives ~log₃₂(N) convergence.
   * Passed to the Bare worker at init so the worklet stays config-free.
   */
  maxConnections: 32,

  /**
   * Bounded local inbox capacity (conf 9 default K=200). Remote posts above
   * this count evict the lowest-similarity entry if the newcomer scores
   * higher. Own posts and responses are kept separately and do not count
   * against this budget.
   */
  inboxCapacity: 200,

  /**
   * Minimum cosine similarity for a remote post to be admitted into the
   * local inbox (conf 9 "loose" threshold = 0.3). Posts below this are
   * dropped at receive time rather than stored and filtered later.
   */
  inboxMinSimilarity: 0.3,

  /**
   * Hard cap on the character length of a post's text. Enforced on BOTH the
   * authoring side (`CreatePost`) and the receiving side (record ingestion):
   * an incoming record whose text exceeds this is dropped before storage.
   * Untrusted peers control `text` freely, so without this a single hostile
   * record could carry a multi-megabyte payload and exhaust memory/disk — a
   * cheap denial-of-service. The value is generous for genuine prose but
   * closes the unbounded-input hole.
   */
  maxPostChars: 4000,

  /**
   * Hard cap on the character length of a response's text. Same DoS rationale
   * as `maxPostChars`; responses are conversational replies, so the bound is
   * tighter.
   */
  maxResponseChars: 2000,
} as const;

export type RoomConfigShape = typeof RoomConfig;
