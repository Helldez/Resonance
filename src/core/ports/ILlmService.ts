export interface LlmGenerateOptions {
  /** Maximum tokens to generate. */
  maxTokens: number;
  /** Sampling temperature. 0 = greedy. */
  temperature: number;
  /** Stop sequences. Generation halts when one is produced. */
  stop?: ReadonlyArray<string>;
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
