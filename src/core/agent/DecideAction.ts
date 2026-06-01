import type { AgentProfile } from '@core/agent/AgentProfile';
import { AgentConfig } from '@core/config/AgentConfig';
import { buildReplyPrompt } from '@core/agent/PromptBuilder';
import { completeJson, type StructuredLlmDeps } from '@core/llm/StructuredLlm';

export interface ReplyDraft {
  readonly text: string;
  readonly rationale: string;
}

/**
 * Draft a reply for a candidate the agent has already decided to comment on
 * (the decision is made from similarity, not here — see `AgentConfig.
 * engagement`). Returns null only when the model fails to produce usable text,
 * which the caller treats as "skip this one", not as a relevance judgement.
 */
export async function draftReply(
  deps: StructuredLlmDeps,
  profile: AgentProfile,
  candidateText: string,
  threadContext: string | null,
): Promise<ReplyDraft | null> {
  return completeJson<ReplyDraft>(
    deps,
    buildReplyPrompt(profile, candidateText, threadContext),
    validateReply,
    { temperature: AgentConfig.textTemperature, maxTokens: AgentConfig.commentMaxTokens },
  );
}

function validateReply(value: unknown): ReplyDraft | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const text = typeof v.text === 'string' ? v.text.trim().slice(0, 240) : '';
  if (text.length === 0) {
    return null;
  }
  const rationale = typeof v.rationale === 'string' ? v.rationale.slice(0, 140) : '';
  return { text, rationale };
}
