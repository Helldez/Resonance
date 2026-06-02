import type { JsonSchema } from '@core/ports/ILlmService';
import { AgentConfig } from '@core/config/AgentConfig';

/**
 * The agent's LLM-backed actions, modelled as "tools" with a JSON schema each.
 * The action is chosen DETERMINISTICALLY by the similarity thresholds (see
 * `engagementBand`) — NOT by the model — so we do not use QVAC's tool-calling
 * (which would let the LLM pick). Instead, for the pre-selected action we pass
 * its `schema` as the response format; the model only fills the payload.
 *
 * `react` and `skip` need no model and have no entry here.
 */
export interface CommentPayload {
  readonly text: string;
  readonly rationale: string;
}
export interface PostPayload {
  readonly text: string;
}

export interface LlmAction<T> {
  /** Grammar-enforced output shape (additionalProperties/required encoded — QVAC `strict` is a no-op). */
  readonly schema: JsonSchema;
  readonly temperature: number;
  readonly maxTokens: number;
  /** Defence-in-depth: validate/clamp even though the grammar already constrains. */
  validate(value: unknown): T | null;
}

const COMMENT_MAX = 240;
const RATIONALE_MAX = 120;
const POST_MAX = 280;

export const CommentAction: LlmAction<CommentPayload> = {
  schema: {
    type: 'object',
    properties: {
      text: { type: 'string', maxLength: COMMENT_MAX },
      rationale: { type: 'string', maxLength: RATIONALE_MAX },
    },
    required: ['text'],
    additionalProperties: false,
  },
  temperature: AgentConfig.textTemperature,
  maxTokens: AgentConfig.commentMaxTokens,
  validate(value: unknown): CommentPayload | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const v = value as Record<string, unknown>;
    const text = typeof v.text === 'string' ? v.text.trim().slice(0, COMMENT_MAX) : '';
    if (text.length === 0) {
      return null;
    }
    const rationale = typeof v.rationale === 'string' ? v.rationale.slice(0, RATIONALE_MAX) : '';
    return { text, rationale };
  },
};

export const PostAction: LlmAction<PostPayload> = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', maxLength: POST_MAX } },
    required: ['text'],
    additionalProperties: false,
  },
  temperature: AgentConfig.textTemperature,
  maxTokens: AgentConfig.postMaxTokens,
  validate(value: unknown): PostPayload | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const v = value as Record<string, unknown>;
    const text = typeof v.text === 'string' ? v.text.trim().slice(0, POST_MAX) : '';
    return text.length > 0 ? { text } : null;
  },
};
