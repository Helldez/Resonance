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
   * Cross-turn thread-echo gate (the user-tunable cosine threshold lives in the
   * profile — `AgentProfile.thresholds.echoMaxCosine`; this is only the internal
   * lookback). Before publishing a drafted reply the agent embeds it and takes
   * the MAX cosine against the post plus the last `echoLookback` thread
   * responses (both authors). At/above the threshold the reply merely restates
   * the conversation and is suppressed, breaking the agent-echoes-agent loop.
   */
  novelty: {
    echoLookback: 6,
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
    /**
     * Similarity thresholds that drive the agent's deterministic decisions
     * (all editable in the "My agent" Advanced section, all cosine in [0,1]):
     *   - reactMinSimilarity   — a post this close to the user gets a "like";
     *   - respondMinSimilarity — this close earns a comment (LLM drafts text);
     *   - echoMaxCosine        — a drafted reply at/above this similarity to the
     *                            thread is an echo and is suppressed.
     * Defaults: react 0.80, comment 0.87, echo 0.97 (echo high → only
     * near-identical restatements are dropped; lower it to bite harder).
     */
    thresholds: {
      reactMinSimilarity: 0.8,
      respondMinSimilarity: 0.87,
      echoMaxCosine: 0.97,
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
