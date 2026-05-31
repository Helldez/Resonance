import type { ILlmService } from '@core/ports/ILlmService';
import { stripThinkTags } from '@core/llm/StripThink';
import { AgentConfig } from '@core/config/AgentConfig';

/**
 * Model-agnostic structured output. Small on-device models do not reliably
 * emit valid JSON from prompting alone, so this helper:
 *   1. asks for a single JSON object,
 *   2. strips any <think> block and extracts the first balanced {...} object
 *      with a character walk (no regex — project rule),
 *   3. JSON-parses and validates it,
 *   4. retries once with a stricter reminder on failure,
 *   5. returns null if it still cannot get a valid object (caller treats null
 *      as "do nothing").
 *
 * When QVAC exposes grammar/GBNF-constrained decoding this can be swapped for a
 * token-level guarantee without changing callers.
 */
export interface StructuredLlmDeps {
  readonly llm: ILlmService;
}

export async function completeJson<T>(
  deps: StructuredLlmDeps,
  prompt: string,
  validate: (value: unknown) => T | null,
  options?: { readonly temperature?: number; readonly maxTokens?: number },
): Promise<T | null> {
  const temperature = options?.temperature ?? AgentConfig.routingTemperature;
  const maxTokens = options?.maxTokens ?? AgentConfig.routingMaxTokens;

  let lastRaw = '';
  for (let attempt = 0; attempt <= AgentConfig.structuredRetries; attempt++) {
    const full =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous answer was not a single valid JSON object:\n${lastRaw}\nReply with ONLY the JSON object, nothing else.`;
    const raw = await deps.llm.complete(full, {
      maxTokens,
      temperature,
      stop: ['\n\n'],
    });
    lastRaw = stripThinkTags(raw).trim();
    const obj = extractFirstJsonObject(lastRaw);
    if (obj !== null) {
      const validated = validate(obj);
      if (validated !== null) {
        return validated;
      }
    }
  }
  return null;
}

/**
 * Parse the first balanced top-level `{...}` object out of `text`. Tracks
 * string and escape state so braces inside strings don't break balance. No
 * regex. Returns the parsed value, or null if none parses.
 */
export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
