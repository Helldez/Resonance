import { HttpModelSources } from './HttpModelSources';

export type ModelKind = 'embedding' | 'llm';

export interface ModelDescriptor {
  readonly id: string;
  readonly kind: ModelKind;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly nativeDim?: number;
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
  } satisfies ModelDescriptor,

  llm: {
    id: 'qwen3-1.7b-q4_0',
    kind: 'llm' as const,
    url: HttpModelSources.qwen3_1_7bQ4_0.url,
    sha256: HttpModelSources.qwen3_1_7bQ4_0.sha256,
    sizeBytes: HttpModelSources.qwen3_1_7bQ4_0.sizeBytes,
  } satisfies ModelDescriptor,
} as const;
