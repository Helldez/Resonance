import type { ReactionType, RecordAddress } from '@core/domain/types';
import type { AgentLimits, Autonomy } from '@core/agent/AgentProfile';

/**
 * What the LLM proposed. The LLM only ever *proposes*; this module is the sole
 * gate that authorises a write. The proposal is untrusted — it may hallucinate.
 */
export type ProposedAction =
  | { readonly kind: 'post'; readonly text: string }
  | { readonly kind: 'respond'; readonly target: RecordAddress; readonly text: string }
  | { readonly kind: 'react'; readonly target: RecordAddress; readonly reaction: ReactionType }
  | { readonly kind: 'none' };

/**
 * Everything the governor needs to decide, computed by the caller from SQLite
 * counters and the agent's memory — never from the LLM. Keeping this a plain
 * data bag makes `evaluateAction` a pure function that is trivial to unit-test.
 */
export interface GovernorState {
  readonly autonomy: Autonomy;
  readonly postsToday: number;
  readonly commentsToday: number;
  readonly reactionsToday: number;
  /** Agent responses already published under the target thread. */
  readonly turnsInThread: number;
  /** True when the last record in the thread is the agent's own, with no human reply since. */
  readonly lastInThreadIsSelfNoHuman: boolean;
  /** True when the proposed text duplicates a recent agent output. */
  readonly dedupHit: boolean;
  readonly limits: AgentLimits;
  /** Global kill switch — when true every action is rejected up front. */
  readonly killSwitch: boolean;
}

export type GovernorDecision =
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'queue' }
  /**
   * `terminal` distinguishes a permanent rejection for THIS candidate
   * (never-list, dedup, per-thread cap, no-two-in-a-row — re-thinking would
   * always reject again, so the caller marks the candidate skipped) from a
   * transient one (daily caps reset at midnight — keep the candidate for a
   * later day).
   */
  | { readonly verdict: 'reject'; readonly reason: string; readonly terminal: boolean };

const ALLOW: GovernorDecision = { verdict: 'allow' };
const QUEUE: GovernorDecision = { verdict: 'queue' };

function reject(reason: string, terminal: boolean): GovernorDecision {
  return { verdict: 'reject', reason, terminal };
}

/**
 * The single deterministic gate. Order matters: the first failing check stops
 * the chain. The LLM's `limits` are read here as data, never enforced by the
 * model itself.
 *
 *   1. kill switch / no-op / autonomy off
 *   2. quality (never-list, dedup) — applied in BOTH suggest and autopilot
 *   3. suggest → queue (a human approves before anything is published)
 *   4. autopilot → daily caps, per-thread turn cap, no-two-in-a-row → allow
 */
export function evaluateAction(action: ProposedAction, state: GovernorState): GovernorDecision {
  // Control-state rejections are transient (not about this candidate's content).
  if (state.killSwitch) {
    return reject('kill switch', false);
  }
  if (action.kind === 'none') {
    return reject('no action', true);
  }
  if (state.autonomy === 'off') {
    return reject('autonomy off', false);
  }

  // 2. Quality guards apply regardless of autonomy. These are TERMINAL for this
  //    candidate: the same text would be rejected on every future tick.
  if (action.kind === 'post' || action.kind === 'respond') {
    const hit = firstNeverHit(action.text, state.limits.never);
    if (hit !== null) {
      return reject(`never-list: "${hit}"`, true);
    }
    if (state.dedupHit) {
      return reject('duplicate of a recent output', true);
    }
  }

  // 3. Suggest mode never publishes — it queues for human approval.
  if (state.autonomy === 'suggest') {
    return QUEUE;
  }

  // 4. Autopilot: enforce the hard caps. Daily caps are TRANSIENT (reset at
  //    midnight) — keep the candidate for another day. Per-thread caps and the
  //    no-two-in-a-row rule are TERMINAL for this candidate.
  if (action.kind === 'post') {
    if (state.postsToday >= state.limits.maxPostsPerDay) {
      return reject('daily post cap reached', false);
    }
    return ALLOW;
  }
  if (action.kind === 'react') {
    if (state.reactionsToday >= state.limits.maxReactionsPerDay) {
      return reject('daily reaction cap reached', false);
    }
    return ALLOW;
  }
  // respond
  if (state.commentsToday >= state.limits.maxCommentsPerDay) {
    return reject('daily comment cap reached', false);
  }
  if (state.turnsInThread >= state.limits.maxTurnsPerThread) {
    return reject('per-thread turn cap reached', true);
  }
  if (state.lastInThreadIsSelfNoHuman) {
    return reject('would reply to self with no new human input', true);
  }
  return ALLOW;
}

/** First never-list phrase contained in `text` (case-insensitive), or null. */
function firstNeverHit(text: string, never: ReadonlyArray<string>): string | null {
  const haystack = text.toLowerCase();
  for (const phrase of never) {
    if (phrase.length > 0 && haystack.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}
