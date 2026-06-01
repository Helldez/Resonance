/**
 * All tunables for the local-AI agent layer. Per the project rule, no agent
 * number is inlined at a call site — it lives here. The agent itself is
 * model-agnostic: it drives whatever LLM `ModelProfiles.llm` points at via the
 * `ILlmService` port, so nothing here names a specific model.
 */
export const AgentConfig = {
  /**
   * How often the agent loop wakes on its own timer (ms), in addition to being
   * nudged when a new record lands. Kept slow: triage runs an LLM call per
   * candidate, so a tight loop would drain battery on a phone.
   */
  tickIntervalMs: 45_000,

  /**
   * Hard cap on how many inbox candidates a single tick will even look at.
   * Bounds the LLM work per wake-up regardless of how full the inbox is.
   */
  maxCandidatesPerTick: 6,

  /**
   * Hard cap on how many reply threads (comments received under the user's
   * posts, or in threads the agent joined) a single tick will follow up on.
   * Kept small: each one costs a decision LLM call, and replies are processed
   * before fresh posts so a busy thread cannot starve them.
   */
  maxReplyCandidatesPerTick: 4,

  /**
   * The agent's action is decided DETERMINISTICALLY from a candidate's stored
   * cosine similarity (MAX vs the user's own posts, or the "About you"
   * fallback) — never from an LLM relevance estimate:
   *   - similarity ≥ `respondMinSimilarity` → comment (the LLM only drafts the
   *     text; the decision to comment is fixed by the threshold);
   *   - similarity ≥ `reactMinSimilarity` → react with a plain "like" (no LLM);
   *   - below `reactMinSimilarity`, or no similarity signal → do nothing.
   * Because cosine is a pure function of the embeddings, the same post always
   * yields the same action. The only non-determinism left is the wording of a
   * comment's text, which is inherently generative.
   */
  engagement: {
    respondMinSimilarity: 0.87,
    reactMinSimilarity: 0.8,
  },

  /**
   * Word-overlap ratio (0..1) above which a freshly proposed text counts as a
   * duplicate of a recent agent output and is rejected by the governor. Keeps
   * the agent from posting the same thought twice.
   */
  dedupOverlapThreshold: 0.6,

  /** How many recent agent outputs the dedup ledger keeps for comparison. */
  dedupHistorySize: 40,

  /**
   * Sampling for the routing calls (triage, decide) — low for determinism.
   * Token budget is generous: even with `/no_think`, a thinking model may emit
   * a short preamble, and the balanced-brace extractor stops at the JSON's
   * closing brace anyway, so a higher ceiling costs nothing on success.
   */
  routingTemperature: 0.1,
  routingMaxTokens: 320,

  /** Sampling for the user-facing text the agent writes. */
  textTemperature: 0.6,
  postMaxTokens: 256,
  commentMaxTokens: 200,

  /** One structured-output retry on malformed JSON before giving up (→ do_nothing). */
  structuredRetries: 1,

  /** Run the reflection/digest summarisation once every N ticks. */
  reflectionEveryNTicks: 20,

  /**
   * Autopilot circuit breaker. The agent pauses itself after this many
   * published actions in one app session, so an unattended autopilot can't run
   * forever (or two agents ping-pong indefinitely). Re-arm by toggling autonomy
   * off→autopilot, or restarting the app. Suggest mode is unaffected (a human
   * approves each draft anyway).
   */
  sessionActionBudget: 12,

  /** Defaults applied to a fresh AgentProfile (the form seeds from these). */
  defaults: {
    name: 'My agent',
    tone: 'concise, honest, specific, no fluff',
    limits: {
      maxPostsPerDay: 2,
      maxCommentsPerDay: 8,
      maxReactionsPerDay: 20,
      maxTurnsPerThread: 3,
      /**
       * Seeded never-list. The agent will not author text whose lowercased
       * form contains any of these phrases — a deterministic guard, not an
       * instruction the model is trusted to follow.
       */
      never: ['hire me', 'follow me', 'buy now', 'subscribe'],
    },
  },

  /** Upper bounds the profile form clamps each limit to. */
  caps: {
    maxPostsPerDay: 20,
    maxCommentsPerDay: 50,
    maxReactionsPerDay: 100,
    maxTurnsPerThread: 6,
    maxInterests: 12,
    maxGoals: 5,
  },
} as const;

export type AgentConfigShape = typeof AgentConfig;
