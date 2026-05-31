/**
 * Tunables for the global "topic atlas" map.
 *
 * The atlas lays posts out by a real 2-D projection of their embeddings
 * (UMAP, with a PCA-2 fallback for small sets — see `AtlasProjection`), so
 * position carries meaning. Spherical k-means then groups posts only to
 * pick colours and label anchors, not to place them. Optionally an on-device
 * LLM names each topic from its most-central posts.
 *
 * Everything that would otherwise be a magic number at a call site lives
 * here (per AGENTS.md). The clustering and projection run purely on
 * embeddings — never on raw text — so they are multilingual by construction
 * and use no stop-word or keyword lists.
 */
export const TopicConfig = {
  /**
   * Topic-count (k) search range. `k` is no longer a fixed heuristic: the
   * atlas runs spherical k-means for every k in [minTopics, maxTopics] and
   * keeps the one with the best mean silhouette (cosine), so the data picks
   * its own granularity. The UI may still expose a slider to override.
   */
  minTopics: 2,
  maxTopics: 8,

  /** Iterations for the Lloyd update loop. Spherical k-means converges fast. */
  kmeansIterations: 25,

  /**
   * Seed for the deterministic RNG used by k-means++ initialisation and by
   * the UMAP projection. Fixed so the same posts always produce the same
   * atlas (the runtime forbids Math.random anyway).
   */
  kmeansSeed: 0x5eed_a7c2,

  /**
   * Minimum posts required to bother clustering. Below this the atlas shows a
   * single "everything" group.
   */
  minPostsForClustering: 4,

  /** Hard cap on posts fed to the atlas (matches the map candidate budget). */
  maxPosts: 400,

  /**
   * 2-D projection (the layout itself). UMAP gives the manifold "islands"
   * look; below `minPointsForUmap` we fall back to deterministic PCA-2.
   */
  projection: {
    minPointsForUmap: 30,
    /** UMAP neighbourhood size; clamped to N-1 at runtime. */
    nNeighbors: 15,
    /** How tightly UMAP packs neighbours (smaller = tighter clumps). */
    minDist: 0.1,
    /** Effective scale of embedded points. */
    spread: 1.0,
    /** Optimisation epochs. */
    nEpochs: 400,
    /** Epochs per cooperative yield, to keep the JS thread responsive. */
    epochsPerBatch: 50,
    /** Power-iteration count for the PCA-2 fallback (matches the per-post map). */
    powerIterations: 24,
    /**
     * Bubble geometry, derived from members' real projected coordinates: the
     * radius is this percentile of member-to-centroid distance (not the max,
     * so one outlier doesn't balloon the bubble) plus a small padding,
     * floored at a minimum so a singleton topic is still visible.
     */
    bubblePercentile: 0.9,
    bubblePadding: 0.04,
    bubbleMinRadius: 0.05,
  },

  /**
   * A topic's instant label is its most-central real post (the medoid),
   * truncated to `labelMaxChars` at a word boundary; the full post shows when
   * the topic is tapped. The optional LLM pass below can replace it with a
   * short name.
   */
  labelMaxChars: 22,

  /**
   * Optional on-device LLM naming pass. Embedding-driven by construction: it
   * feeds the topic's `topKPosts` most-central posts (no keywords, no regex)
   * to the LLM and asks for a 2-4 word name. Non-blocking and best-effort —
   * the medoid label stands if the model isn't loaded or a call fails.
   */
  naming: {
    topKPosts: 5,
    maxTokens: 16,
    temperature: 0,
    perTopicTimeoutMs: 4000,
  },
} as const;

export type TopicConfigShape = typeof TopicConfig;
