/**
 * Networking parameters. Default Hyperswarm bootstrap = empty array, which
 * means "use the Holepunch public DHT bootstrap nodes baked into the
 * library". An app can override this in dev to point to a local DHT.
 */
export const NetworkConfig = {
  /** Override Hyperswarm bootstrap nodes. Empty = use defaults. */
  bootstrap: [] as ReadonlyArray<{ host: string; port: number }>,

  /**
   * Topic namespace prefix. Hyperswarm topics are 32-byte values; we
   * derive ours as `sha256(topicPrefix || bucketId)` so we never collide
   * with another app sharing the public DHT.
   *
   * Version bump history:
   *   v1 → v2 — embedding model swap (EmbeddingGemma 256-dim →
   *             bge-m3 1024-dim) + LSH listening algorithm change
   *             (centroid multi-table → per-post single-seed with
   *             centroid fill-up). Both peers and bucket ids are
   *             semantically incompatible across this boundary.
   */
  topicPrefix: 'resonance/v2/bucket/',

  /** Max concurrent peer connections per joined bucket. */
  maxConnectionsPerBucket: 32,
} as const;
