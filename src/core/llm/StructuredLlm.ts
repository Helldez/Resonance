import type { ILlmService, JsonSchema } from '@core/ports/ILlmService';
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
  options?: {
    readonly temperature?: number;
    readonly maxTokens?: number;
    /** Persona system message. */
    readonly system?: string;
    /** Grammar-constrain the output to this schema (valid JSON first-try). */
    readonly responseSchema?: JsonSchema;
  },
): Promise<T | null> {
  const temperature = options?.temperature ?? AgentConfig.routingTemperature;
  const maxTokens = options?.maxTokens ?? AgentConfig.routingMaxTokens;

  let lastRaw = '';
  for (let attempt = 0; attempt <= AgentConfig.structuredRetries; attempt++) {
    // `/no_think` switches Qwen3 (and other thinking models) out of reasoning
    // mode for this turn, so the tiny token budget is spent on the JSON itself
    // rather than an unclosed <think> block — the latter made stripThinkTags
    // return '' and every structured call return null. Harmless on models that
    // don't recognise it.
    const base = `${prompt}\n/no_think`;
    const full =
      attempt === 0
        ? base
        : `${base}\n\nYour previous answer was not a single valid JSON object:\n${lastRaw}\nReply with ONLY the JSON object, nothing else.`;
    // No stop sequence: '\n\n' could fire inside a think block or between a
    // brace and its contents, truncating the JSON. We rely on maxTokens + the
    // balanced-brace extractor to bound the output instead.
    const raw = await deps.llm.complete(full, {
      maxTokens,
      temperature,
      system: options?.system,
      responseSchema: options?.responseSchema,
    });
    lastRaw = stripThinkTags(raw).trim();
    // With `responseSchema` the grammar guarantees a bare JSON object, so try a
    // direct parse first; fall back to the balanced-brace walk for the
    // unconstrained path (or a model that leaks a preamble despite the schema).
    let obj: unknown = null;
    try {
      obj = JSON.parse(lastRaw);
    } catch {
      obj = extractFirstJsonObject(lastRaw);
    }
    if (obj !== null) {
      const validated = validate(obj);
      if (validated !== null) {
        return validated;
      }
    }
    console.warn(
      `[agent] completeJson attempt=${attempt} rawLen=${raw.length} stripped="${lastRaw.slice(0, 120)}" -> ${obj === null ? 'no-json' : 'invalid-shape'}`,
    );
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
