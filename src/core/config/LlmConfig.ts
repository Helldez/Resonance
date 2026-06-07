/**
 * Tunables for the platform LLM service itself (not the agent — those live in
 * AgentConfig). Per the project rule, no number is inlined at a call site.
 */
export const LlmConfig = {
  /**
   * Watchdog: maximum wait for the FIRST token of a completion (ms). Covers
   * the whole prefill, which on a throttled phone can legitimately take tens
   * of seconds for a long persona+post prompt — so this is deliberately wide.
   * On expiry the request is cancelled and the call rejects, instead of
   * holding the serial completion queue (and every caller behind it) forever.
   */
  firstTokenTimeoutMs: 120_000,

  /**
   * Watchdog: maximum gap BETWEEN tokens once decoding has started (ms).
   * Decoding produces a steady token stream even on slow hardware, so a long
   * silence here means the request is wedged, not slow.
   */
  tokenGapTimeoutMs: 30_000,

  /**
   * After cancelling a request (client-side stop or watchdog expiry), how long
   * to wait for the worker stream to reach a terminal state before giving up
   * (ms). Draining matters: the serial queue must only advance once the model
   * is actually free, or the next completion is rejected by QVAC's registry
   * concurrency policy ("another completion request is already running").
   */
  cancelDrainTimeoutMs: 10_000,
} as const;

export type LlmConfigShape = typeof LlmConfig;
