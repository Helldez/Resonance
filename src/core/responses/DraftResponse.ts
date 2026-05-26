import type { ScoredPost } from '@core/domain/types';
import type { ILlmService } from '@core/ports/ILlmService';
import { MatchingConfig } from '@core/config/MatchingConfig';

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
  ].join('\n');

  const draftText = await deps.llm.complete(prompt, {
    maxTokens: 256,
    temperature: 0.6,
    stop: ['\n---', '\nTheir post:', '\nAbout you'],
  });
  return { draftText: draftText.trim() };
}
