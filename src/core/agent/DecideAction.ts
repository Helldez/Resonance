import type { AgentProfile } from '@core/agent/AgentProfile';
import { CommentAction, type CommentPayload } from '@core/agent/AgentActions';
import { buildReplyPrompt, buildPersonaPrefix } from '@core/agent/PromptBuilder';
import { personaCacheKey } from '@core/agent/PersonaCache';
import { completeJson, type StructuredLlmDeps } from '@core/llm/StructuredLlm';

export type ReplyDraft = CommentPayload;

/**
 * Draft a reply for a candidate the agent has already decided to comment on
 * (the decision is made from similarity, not here — see `AgentConfig.
 * engagement`). The persona goes in as the cached `system` message; the output
 * is grammar-constrained to the comment schema. Returns null only when the
 * model fails to produce usable text — the caller treats that as "skip this
 * one", not as a relevance judgement.
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
    CommentAction.validate,
    {
      temperature: CommentAction.temperature,
      maxTokens: CommentAction.maxTokens,
      responseSchema: CommentAction.schema,
      system: buildPersonaPrefix(profile),
      kvCache: personaCacheKey(profile),
    },
  );
}
