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
   * Used as the user's interest text when "About you" is empty. Drives
   * both the LSH bucket and (until the user has posted anything) the
   * fallback similarity computation in `ScoreIncomingPost`.
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
