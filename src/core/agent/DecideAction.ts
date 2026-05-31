import type { ReactionType } from '@core/domain/types';
import { REACTION_TYPES } from '@core/domain/types';
import type { AgentProfile } from '@core/agent/AgentProfile';
import { buildDecisionPrompt } from '@core/agent/PromptBuilder';
import { completeJson, type StructuredLlmDeps } from '@core/llm/StructuredLlm';

export type DecisionAction = 'respond' | 'react' | 'do_nothing';

export interface Decision {
  readonly action: DecisionAction;
  readonly text: string;
  readonly reaction: ReactionType | null;
  readonly rationale: string;
}

/** Pick exactly one action for a candidate that passed triage. */
export async function decideAction(
  deps: StructuredLlmDeps,
  profile: AgentProfile,
  candidateText: string,
  threadContext: string | null,
): Promise<Decision | null> {
  return completeJson<Decision>(
    deps,
    buildDecisionPrompt(profile, candidateText, threadContext),
    validateDecision,
  );
}

function validateDecision(value: unknown): Decision | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const action = v.action;
  if (action !== 'respond' && action !== 'react' && action !== 'do_nothing') {
    return null;
  }
  const text = typeof v.text === 'string' ? v.text.trim().slice(0, 240) : '';
  const rationale = typeof v.rationale === 'string' ? v.rationale.slice(0, 140) : '';
  const reaction = parseReaction(v.reaction);

  // Reject incoherent proposals so the caller falls back to doing nothing.
  if (action === 'respond' && text.length === 0) {
    return null;
  }
  if (action === 'react' && reaction === null) {
    return null;
  }
  return { action, text, reaction, rationale };
}

function parseReaction(value: unknown): ReactionType | null {
  if (typeof value !== 'string') {
    return null;
  }
  for (const t of REACTION_TYPES) {
    if (t === value) {
      return t;
    }
  }
  return null;
}
