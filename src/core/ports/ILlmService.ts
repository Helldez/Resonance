/**
 * A minimal JSON-schema shape the agent uses to constrain LLM output. Kept as a
 * plain structural type (no `@qvac` import) so core stays platform-agnostic; the
 * platform adapter maps it to QVAC's `responseFormat: { type: 'json_schema' }`,
 * which llama.cpp compiles to GBNF and enforces during decoding. Note QVAC's
 * `strict` flag is a no-op, so `additionalProperties` and `required` must be
 * encoded here explicitly.
 */
export interface JsonSchemaProp {
  readonly type: 'string' | 'number' | 'integer' | 'boolean';
  readonly maxLength?: number;
  readonly description?: string;
}

export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProp>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean;
}

export interface LlmGenerateOptions {
  /** Maximum tokens to generate. */
  maxTokens: number;
  /** Sampling temperature. 0 = greedy. */
  temperature: number;
  /** Stop sequences. Generation halts when one is produced. */
  stop?: ReadonlyArray<string>;
  /**
   * Stable system message (the agent persona). Sent as a `system` turn so it is
   * part of the KV-cache `configHash` and reused across calls with the same
   * `kvCache` key.
   */
  system?: string;
  /** Constrain the output to this JSON schema (grammar-enforced by the model). */
  responseSchema?: JsonSchema;
}

export interface ILlmService {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  /** One-shot completion. */
  complete(prompt: string, options: LlmGenerateOptions): Promise<string>;

  /**
   * Streaming completion. The callback receives token chunks as they are
   * produced. Resolves when generation ends (eos or stop or maxTokens).
   */
  completeStream(
    prompt: string,
    options: LlmGenerateOptions,
    onChunk: (chunk: string) => void,
  ): Promise<void>;
}
