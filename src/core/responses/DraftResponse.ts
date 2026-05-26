import type { ScoredPost } from '@core/domain/types';
import type { ILlmService } from '@core/ports/ILlmService';
import { MatchingConfig } from '@core/config/MatchingConfig';

// Qwen3 in "thinking" mode emits <think>...</think> blocks before the
// real answer. We strip them so the draft shown to the user contains only
// the reply text. char-walk per AGENTS.md (no regex).
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

function stripThinkTags(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith(THINK_OPEN, i)) {
      const close = s.indexOf(THINK_CLOSE, i + THINK_OPEN.length);
      if (close === -1) {
        // Unclosed think block — drop everything from here to end.
        break;
      }
      i = close + THINK_CLOSE.length;
      continue;
    }
    out += s[i];
    i++;
  }
  return out.trim();
}

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

  const raw = await deps.llm.complete(prompt, {
    maxTokens: 256,
    temperature: 0.6,
    stop: ['\n---', '\nTheir post:', '\nAbout you'],
  });
  return { draftText: stripThinkTags(raw) };
}
