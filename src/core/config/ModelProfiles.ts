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
    id: 'bge-m3-q8_0',
    kind: 'embedding' as const,
    url: HttpModelSources.bgeM3Q8.url,
    sha256: HttpModelSources.bgeM3Q8.sha256,
    sizeBytes: HttpModelSources.bgeM3Q8.sizeBytes,
    nativeDim: 1024,
  } satisfies ModelDescriptor,

  llm: {
    id: 'qwen3-1.7b-q4_0',
    kind: 'llm' as const,
    url: HttpModelSources.qwen3_1_7bQ4_0.url,
    sha256: HttpModelSources.qwen3_1_7bQ4_0.sha256,
    sizeBytes: HttpModelSources.qwen3_1_7bQ4_0.sizeBytes,
  } satisfies ModelDescriptor,
} as const;
