/**
 * Single-room ("Keet model") networking parameters — ResonanceSim conf 9.
 *
 * The whole app converges on ONE shared P2P room: every node joins a single
 * Hyperswarm topic, and peer outbox keys gossip transitively so every post
 * eventually reaches every peer (~log₃₂(N) hops). There are no semantic
 * buckets, no DHT routing table, and no sticky peers — routing is delegated
 * to Hyperswarm peer discovery plus the directory-gossip protocol in
 * `bare/announce-directory.mjs`.
 *
 * All conf-9 knobs live here so nothing is hard-coded in the worker or the
 * UI. Changing `topicPrefix` or `roomId` partitions the network.
 */
/**
 * Optional capability secret mixed into the topic derivation (see
 * `networkSalt` below). Read from the `EXPO_PUBLIC_NETWORK_SALT` env var:
 * Expo inlines `EXPO_PUBLIC_*` values from `.env` (gitignored) at bundle
 * time; the desktop peer and Node scripts read the same variable from the
 * process environment. Empty (the default for anyone cloning the repo)
 * means the public network.
 */
const envNetworkSalt: string =
  typeof process !== 'undefined' && process.env
    ? (process.env.EXPO_PUBLIC_NETWORK_SALT ?? '')
    : '';

export const RoomConfig = {
  /**
   * The one shared room. The Hyperswarm topic is derived as
   * `sha256(topicPrefix || networkSalt || roomId)`; every peer computes the
   * same value and therefore lands in the same swarm.
   */
  roomId: 'global',

  /**
   * Topic namespace prefix. Hyperswarm topics are 32-byte values; we derive
   * ours as `sha256(topicPrefix || networkSalt || roomId)` so we never collide
   * with another app sharing the public DHT.
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
   *   v4 → v5 — announce-then-pull: the directory channel now gossips signed
   *             ANNOUNCEMENTS (author + embedding + digest) instead of outbox
   *             keys, and peers pull only the records they admit (sparse) rather
   *             than replicating every core. The room protocol is incompatible
   *             with v4 peers, so the prefix bump isolates them.
   *   v5 → v6 — announce gossip wire format: JSON-text announcements replaced
   *             by compact-encoding binary (a 768-dim announcement shrinks
   *             ~15KB → ~3.2KB) and the on-open snapshot is sent in bounded
   *             batches (`announceBatchSize`) instead of one message. At 1063
   *             announcements the single-message snapshot was ~15.6MB — above
   *             the transport's frame cap — so every connection died at open.
   *             The announce channel protocol bumps to `resonance-announce/v2`;
   *             the prefix bump isolates v5 peers.
   */
  topicPrefix: 'resonance/v6/room/',

  /**
   * Capability-based network partition. The topic seed sent to the worker is
   * `topicPrefix + networkSalt`, so a non-empty salt yields a topic that is
   * NOT derivable from the public source code — only peers that share the
   * same out-of-band secret land in the same swarm. This is how a private
   * dev/test network is isolated from the public one (the committed
   * `topicPrefix` is readable by anyone, so versioning alone partitions but
   * never protects). Empty string ⇒ the public network. Set via
   * `EXPO_PUBLIC_NETWORK_SALT` in `.env` (see `.env.example`); use a
   * high-entropy value (e.g. 32 random bytes hex) — a guessable salt is
   * brute-forceable offline.
   */
  networkSalt: envNetworkSalt,

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

  /**
   * Tier-1 capacity (announce-then-pull). The directory now gossips lightweight
   * announcements instead of full records; every announcement a node
   * sees is kept here as a cheap summary and ranked locally. Only the ~K
   * winners are pulled in full (`inboxCapacity`). Tier-1 is generously sized
   * because ranking is the whole point — the larger it is, the closer the
   * local top-K is to the true global top-K — but it is still bounded so a
   * flood cannot grow it without limit. Lowest-scoring non-pulled summaries are
   * evicted first.
   */
  announceTier1Capacity: 5000,

  /**
   * Maximum announcements per gossip message. The on-open snapshot grows with
   * the room's history; as a single message it eventually exceeds the
   * transport's max frame size and the connection is destroyed at open
   * (observed at 1063 announcements). Batching bounds every message to
   * roughly `announceBatchSize × ~3.2KB` regardless of network size.
   */
  announceBatchSize: 100,

  /**
   * How long a single sparse block pull waits before giving up (ms). After an
   * announcement wins admission we open the author's outbox core and request
   * exactly its one block; if no peer holding it answers within this window the
   * pull is abandoned (and may be retried) rather than blocking the inbox.
   */
  pullTimeoutMs: 8000,
} as const;

export type RoomConfigShape = typeof RoomConfig;
