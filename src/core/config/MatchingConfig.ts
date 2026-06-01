/**
 * All tunables for the semantic matching pipeline live here. If a number
 * appears in matching code that is NOT pulled from this file, that's a bug.
 *
 * The initial values below are seeded for development. They MUST be
 * recalibrated by the Milestone 0 script before the MVP ships:
 * `npm run calibrate`.
 */
export const MatchingConfig = {
  /**
   * Embedding dimension. EmbeddingGemma-300M produces 768-dim dense
   * vectors; the single-room model (conf 9) uses the full 768 with the
   * "clustering" prompt template (see `ModelProfiles.embedding`). There is
   * no Matryoshka truncation here — 768 is the project-wide convention.
   *
   * Network-wide constant: changing the dim or the model implies bumping
   * `RoomConfig.topicPrefix` to isolate peers using incompatible embedding
   * spaces. A mismatch also triggers `PostRepository.dropIfDimChanged`.
   */
  embeddingDim: 768,

  /**
   * Default minimum cosine similarity for an incoming post to be surfaced
   * in the inbox view. Conf 9 uses the "loose" 0.3 threshold; users can
   * raise it in Settings. Note this is the user-facing *view* filter — the
   * hard *admission* threshold for the bounded inbox is
   * `RoomConfig.inboxMinSimilarity`.
   */
  defaultInboxSimilarityThreshold: 0.3,

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
   * Used as the user's interest text when "About you" is empty. In the
   * single-room model it only drives the cold-start similarity scorer (the
   * fallback in `ScoreIncomingPost`) until the user has posted anything —
   * it no longer affects routing.
   */
  fallbackInterestText:
    'general interest in technology, life, and meaningful conversations',

  /**
   * Filtering model: each incoming remote post is scored as the
   * MAX cosine similarity against the current user's own posts. With
   * zero own posts (cold start) we fall back to similarity against the
   * embedding of the user's "About you" text.
   */
  similarityAggregation: 'max-vs-own-posts' as 'max-vs-own-posts',

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
   * Reference rings drawn on the radial-similarity map. Values are cosine
   * similarities; the map projects them to radii via `(1 - sim) / 2`.
   * Kept aligned with `thresholdPresets` so the same vocabulary appears
   * in Settings (chip labels) and on the map (ring labels). Must be sorted
   * descending. The ring whose value equals the active inbox threshold is
   * highlighted at render time — see `ThemeConfig.map.referenceRingActive*`.
   */
  mapReferenceRings: {
    similarities: [0.85, 0.7, 0.5, 0.3] as ReadonlyArray<number>,
  },

  /**
   * Anisotropy floor for the radial map. EmbeddingGemma's vectors are
   * anisotropic: even unrelated texts share a high baseline cosine (~0.3-0.5),
   * never near 0. Mapping radius as a raw `(1 - sim)/2` therefore crams every
   * point into the centre and wastes the outer rings. We instead rescale
   * cosine from `[floor, 1]` onto `[0, 1]` before computing the radius, so the
   * full disc is used and the rings spread out. The same transform is applied
   * to the reference-ring radii so labels stay aligned with the dots.
   *
   * `floor` is the empirical cosine below which two gemma-768 texts are
   * effectively unrelated; calibrate with `npm run calibrate`. Points at or
   * below the floor sit on the rim.
   */
  mapRadialAnisotropyFloor: 0.3,

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
