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
    id: 'embeddinggemma-300m-q5_k_m',
    kind: 'embedding' as const,
    url: HttpModelSources.embeddingGemma300mQ5.url,
    sha256: HttpModelSources.embeddingGemma300mQ5.sha256,
    sizeBytes: HttpModelSources.embeddingGemma300mQ5.sizeBytes,
    nativeDim: 768,
  } satisfies ModelDescriptor,

  llm: {
    id: 'qwen3-4b-instruct-q4_k_m',
    kind: 'llm' as const,
    url: HttpModelSources.qwen3_4bInstructQ4.url,
    sha256: HttpModelSources.qwen3_4bInstructQ4.sha256,
    sizeBytes: HttpModelSources.qwen3_4bInstructQ4.sizeBytes,
  } satisfies ModelDescriptor,
} as const;
