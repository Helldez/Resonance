import type { ScoredPost } from '@core/domain/types';
import type { ILlmService } from '@core/ports/ILlmService';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { stripThinkTags } from '@core/llm/StripThink';

export interface DraftResponseDeps {
  readonly llm: ILlmService;
}

export interface DraftResponseInput {
  readonly post: ScoredPost;
  /**
   * Receiver's self-context: a short, user-supplied description of who they
   * are and what they know. Stays on-device, never serialised over the wire.
   */
  readonly receiverContext: string;
}

export interface DraftResponseResult {
  readonly draftText: string;
}

/**
 * Produce a first-person reply draft for the receiving user to review and
 * (in Mode B) edit before publishing. The system prompt lives in
 * MatchingConfig.prompts so it can be tuned without touching this file.
 */
export async function draftResponse(
  deps: DraftResponseDeps,
  input: DraftResponseInput,
): Promise<DraftResponseResult> {
  // `/no_think` switches Qwen3 (and other thinking models) out of reasoning
  // mode for this turn, so the small token budget goes into the reply itself
  // rather than a <think> block — which could swallow the whole budget (or
  // trip a stop sequence mid-think) and leave the user an empty draft.
  // Harmless on models that don't recognise it. Same trick as StructuredLlm.
  const prompt = [
    MatchingConfig.prompts.draftResponseSystem,
    '',
    '---',
    'About you (private, do not echo back):',
    input.receiverContext.trim(),
    '---',
    'Their post:',
    input.post.post.text.trim(),
    '---',
    'Your reply:',
    '/no_think',
  ].join('\n');

  const raw = await deps.llm.complete(prompt, {
    maxTokens: 256,
    temperature: 0.6,
    stop: ['\n---', '\nTheir post:', '\nAbout you'],
  });
  return { draftText: stripThinkTags(raw) };
}
