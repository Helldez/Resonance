/**
 * Produces L2-normalised embedding vectors for a piece of text.
 *
 * Implementations live in `src/platform/<target>/` and delegate to the
 * Bare worklet running QVAC's `llamacpp-embedding` plugin.
 */
export interface IEmbeddingService {
  /** Lifecycle: load the embedding model into memory. */
  initialize(): Promise<void>;

  /** Free model resources. */
  shutdown(): Promise<void>;

  /**
   * Embed a single text. Returned vector is L2-normalised and truncated
   * to the dimension declared in `MatchingConfig.embeddingDim`.
   */
  embed(text: string): Promise<Float32Array>;

  /** Native output dimension of the loaded model (e.g. 768). */
  readonly nativeDim: number;

  /** Truncated dimension actually used by the app (e.g. 256). */
  readonly outputDim: number;
}
