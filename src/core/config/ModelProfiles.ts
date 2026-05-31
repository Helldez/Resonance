import { HttpModelSources } from './HttpModelSources';

export type ModelKind = 'embedding' | 'llm';

export interface ModelDescriptor {
  readonly id: string;
  readonly kind: ModelKind;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly nativeDim?: number;
  /**
   * Optional instruction template applied to every text before embedding.
   * `{text}` is replaced with the trimmed input. EmbeddingGemma expects a
   * task prompt; the single-room model (conf 9) uses the "clustering" task
   * so the attractor tightens intra-topic ranking without harming routing
   * (there is no bucket gating to distort).
   */
  readonly promptTemplate?: string;

  /**
   * Optional plugin load config forwarded verbatim to `loadModel`'s
   * `modelConfig` (see `@qvac/sdk` llamacpp-embedding `loadConfigSchema`:
   * `pooling`, `attention`, `embdNormalize`, …). Encoder models like
   * EmbeddingGemma load fine on the defaults, so this is omitted for them.
   * Decoder-only models (e.g. Qwen3-Embedding) need
   * `{ pooling: 'last', attention: 'causal' }` — but note that only fixes the
   * desktop build; the Android prebuilt still segfaults (see HttpModelSources).
   */
  readonly loadConfig?: Readonly<Record<string, unknown>>;
}

/**
 * The two models the MVP uses. Profile ids are referenced from the
 * settings store and the bootstrap flow.
 */
export const ModelProfiles = {
  embedding: {
    id: 'embeddinggemma-300m-q8_0',
    kind: 'embedding' as const,
    url: HttpModelSources.embeddingGemma300mQ8.url,
    sha256: HttpModelSources.embeddingGemma300mQ8.sha256,
    sizeBytes: HttpModelSources.embeddingGemma300mQ8.sizeBytes,
    nativeDim: 768,
    promptTemplate: 'task: clustering | query: {text}',
  } satisfies ModelDescriptor,

  llm: {
    id: 'qwen3-1.7b-q4_0',
    kind: 'llm' as const,
    url: HttpModelSources.qwen3_1_7bQ4_0.url,
    sha256: HttpModelSources.qwen3_1_7bQ4_0.sha256,
    sizeBytes: HttpModelSources.qwen3_1_7bQ4_0.sizeBytes,
  } satisfies ModelDescriptor,
} as const;
