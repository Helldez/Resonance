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
   * Minimum cosine similarity (= dot product on L2-normalised vectors)
   * for an incoming post to be surfaced to the receiving user. Below
   * this we silently drop it. Calibrated by `scripts/calibration`.
   */
  inboxSimilarityThreshold: 0.78,

  /**
   * Cap on inbox results per sync cycle. Prevents one chatty bucket from
   * flooding the UI.
   */
  inboxMaxResults: 50,

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
