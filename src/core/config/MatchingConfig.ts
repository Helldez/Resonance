/**
 * All tunables for the semantic matching pipeline live here. If a number
 * appears in matching code that is NOT pulled from this file, that's a bug.
 *
 * The initial values below are seeded for development. They MUST be
 * recalibrated by the Milestone 0 script before the MVP ships:
 * `npm run calibrate`.
 */
export const MatchingConfig = {
  /** Truncated dimension used by the app, via Matryoshka. */
  embeddingDim: 256,

  /**
   * Bits in the LSH bucket id. With 8 bits we partition the embedding
   * space into 256 coarse buckets. Each bucket becomes one Hyperswarm
   * topic.
   */
  lshBits: 8,

  /**
   * Seed for the LSH random hyperplanes. The same seed across all peers
   * MUST produce the same hyperplanes — otherwise peers route to
   * inconsistent buckets. This is a network-wide constant; do not change
   * post-launch without a coordinated migration.
   */
  lshSeed: 0xa57e_b3c1,

  /**
   * Number of independent LSH tables. Each peer announces in L topics
   * (one per table). Two peers see each other if they collide in any
   * table — recall jumps from ~20% (L=1) to ~83% (L=8) at cos_sim 0.85.
   * See `docs/SEMANTIC_ROUTING.md` §4 (Tier 2).
   *
   * Network-wide constant: changing L partitions the network. Coordinate
   * with the topic prefix bump in `NetworkConfig.topicPrefix` if you
   * have to change it.
   */
  lshTables: 8,

  /**
   * Seeds for the L tables — one independent hyperplane family each.
   * Hard-coded so all peers compute the same partitions. Length MUST
   * equal `lshTables`.
   */
  lshSeeds: [
    0xa57e_b3c1,
    0x13c5_9f02,
    0x9e44_27ad,
    0x5b86_d31e,
    0x77a0_8e5b,
    0xc2f9_4760,
    0x18df_3a92,
    0xeb31_b2c7,
  ] as ReadonlyArray<number>,

  /**
   * Default minimum cosine similarity for an incoming post to be surfaced
   * in the inbox. 0 = show every replicated post (MVP default). Users
   * raise it in Settings once they have enough peers to want filtering.
   */
  defaultInboxSimilarityThreshold: 0.0,

  /**
   * Preset choices exposed in the Settings UI for the similarity
   * threshold. Keep the labels short — they're rendered as chips.
   */
  thresholdPresets: [
    { label: 'Show all', value: 0.0, hint: 'No filter — every replicated post lands in the inbox' },
    { label: 'Very loose', value: 0.3, hint: 'Drop only obviously unrelated posts' },
    { label: 'Loose', value: 0.5, hint: 'Posts that share a clear theme with your interests' },
    { label: 'Balanced', value: 0.7, hint: 'Strongly related posts only' },
    { label: 'Strict', value: 0.85, hint: 'Near-identical interests only' },
  ] as ReadonlyArray<{ label: string; value: number; hint: string }>,

  /**
   * Cap on inbox results per query. Prevents one chatty bucket from
   * flooding the UI.
   */
  inboxMaxResults: 100,

  /**
   * Interval at which the Inbox and Thread screens re-poll SQLite to
   * surface newly-replicated records. P2P records arrive asynchronously
   * via the network event handler — without this re-poll the UI would
   * only update on screen focus.
   */
  uiRefreshIntervalMs: 3000,

  /**
   * Hard cap on how many responses a single peer can post under a given
   * post. The MVP semantic is "one perspective per peer per post" —
   * publishing a second response is rejected until the first is deleted.
   */
  maxResponsesPerPeerPerPost: 1,

  /**
   * Used as the user's interest text when "About you" is empty. Drives
   * both the LSH bucket and (until the user has posted anything) the
   * fallback similarity computation in `ScoreIncomingPost`.
   */
  fallbackInterestText:
    'general interest in technology, life, and meaningful conversations',

  /**
   * Instruction template prefixed to every text submitted to
   * EmbeddingGemma. The model is task-conditioned; without an explicit
   * task tag it falls back to a generic embedding that is measurably
   * worse for similarity comparisons. We pick "sentence similarity"
   * because every post in Resonance plays both roles — sometimes the
   * needle, sometimes the haystack. The literal `{text}` placeholder is
   * substituted at call time.
   *
   * Reference: Google's EmbeddingGemma model card on Hugging Face
   * (`task: sentence similarity | query: <text>`). Keep the literal
   * exactly as documented — variants like "STS" do not match what the
   * model was trained on.
   */
  embeddingInstruction: 'task: sentence similarity | query: {text}',

  /**
   * Filtering model: each incoming remote post is scored as the
   * MAX cosine similarity against the current user's own posts. With
   * zero own posts (cold start) we fall back to similarity against the
   * embedding of the user's "About you" text.
   */
  similarityAggregation: 'max-vs-own-posts' as 'max-vs-own-posts',

  /**
   * Minimum number of own posts before the bucket membership switches
   * from "About-you driven" to "centroid of recent own posts" driven.
   * Below this threshold the bucket is determined by `receiverContext`
   * (or fallback) so a brand-new user still joins a sensible bucket.
   */
  postDrivenMinOwnPosts: 3,

  /**
   * Rolling window of own posts used to compute the centroid that drives
   * bucket membership. Older posts beyond this window are ignored, so
   * the bucket follows the user's recent interests rather than ancient
   * history.
   */
  postDrivenWindow: 10,

  /**
   * Hard cap on how many remote posts the semantic map will fetch and
   * project. PCA-2 over 200 vectors of 256 dims is cheap; beyond that the
   * map becomes visually crowded before it becomes computationally heavy.
   */
  mapMaxCandidates: 200,

  /**
   * Posts whose similarity to the user's anchor falls below this value are
   * still plotted on the map (the whole point of the map is to make the
   * geometry visible, including near-misses). The Inbox keeps its own,
   * user-controlled filter via `similarityThreshold` in `SettingsStore`.
   */
  mapMinSimilarityToPlot: -1.0,

  /**
   * Dimensionality reduction strategy used by `projectToPlane`. PCA-2 is
   * deterministic, pure TS, and fast enough on-device. UMAP in the Bare
   * worklet is the planned upgrade.
   */
  mapProjectionMethod: 'radial-sim' as 'pca-2' | 'radial-sim',

  /**
   * Iterations for the power-iteration step in PCA-2. With L2-normalised
   * 256-dim vectors and ≤200 samples, convergence is well inside 20 steps.
   */
  mapPcaPowerIterations: 24,

  /**
   * Pinch-zoom clamp on the map. 1.0 = fit-to-screen.
   */
  mapZoomMin: 0.5,
  mapZoomMax: 8.0,

  /**
   * Edges from the anchor star to peer stars are drawn only above this
   * similarity. Cosine over L2-unit vectors lives in `[-1, 1]`. Below the
   * floor the peer is plotted but the line is suppressed, to avoid
   * obscuring the geometry with low-information strokes.
   */
  mapLineMinSimilarity: 0.0,

  /**
   * Up to K peers — the closest ones by similarity — get a numeric label
   * drawn next to their star on the canvas. Tapping any star always
   * surfaces the exact value in the bottom sheet.
   */
  mapLabelTopK: 5,
  mapLabelMinSimilarity: 0.3,

  /**
   * Prompts used by the response draft pipeline. Kept here, not at call
   * site, so they can be A/B-tested without touching use-case code.
   */
  prompts: {
    draftResponseSystem:
      'You are helping the user draft a short, honest, first-person reply to ' +
      'someone they do not know personally, who shared the thought or need ' +
      'below. Reply only if the user can plausibly contribute something ' +
      'specific. Keep it under four sentences. No greetings, no sign-off.',
  },
} as const;

export type MatchingConfigShape = typeof MatchingConfig;
