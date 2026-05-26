import type { IEmbeddingService } from '@core/ports/IEmbeddingService';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { l2NormalizeInPlace } from '@core/matching/L2Normalize';

/**
 * Embedding service backed by QVAC's `llamacpp-embedding` plugin running in
 * the Bare worklet. Output is truncated (Matryoshka) and L2-normalised
 * before returning, so all downstream code can rely on the convention.
 *
 * Stub for now — wired in Milestone 2.
 */
export class QvacEmbeddingService implements IEmbeddingService {
  readonly nativeDim = ModelProfiles.embedding.nativeDim ?? 768;
  readonly outputDim = MatchingConfig.embeddingDim;

  async initialize(): Promise<void> {
    // TODO M2: RPC -> worklet.loadEmbedding(ModelProfiles.embedding)
  }

  async shutdown(): Promise<void> {
    // TODO M2
  }

  async embed(_text: string): Promise<Float32Array> {
    // TODO M2: RPC -> worklet.embed(text). Truncate to outputDim, normalise.
    // The shape below documents the post-condition for callers.
    const fake = new Float32Array(this.outputDim);
    return l2NormalizeInPlace(fake);
  }
}
