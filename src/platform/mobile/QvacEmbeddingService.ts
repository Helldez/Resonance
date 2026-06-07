import { embed, unloadModel } from '@qvac/sdk';
import type { ModelProgressUpdate } from '@qvac/sdk';
import type { IEmbeddingService } from '@core/ports/IEmbeddingService';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { l2NormalizeInPlace } from '@core/matching/L2Normalize';
import { loadWithFallback } from '../shared/LoadWithFallback';
import { auditInference } from '../shared/InferenceAudit';

export type EmbeddingProgressCallback = (p: ModelProgressUpdate) => void;

/**
 * Embedding service backed by QVAC's `llamacpp-embedding` plugin. The
 * @qvac/sdk handles model download and the call into the Bare worklet
 * automatically — we don't manage RPC ourselves.
 *
 * Output: a Float32Array L2-normalised at `MatchingConfig.embeddingDim`
 * (Matryoshka truncation from the model's native dim).
 */
export class QvacEmbeddingService implements IEmbeddingService {
  readonly nativeDim = ModelProfiles.embedding.nativeDim ?? 768;
  readonly outputDim = MatchingConfig.embeddingDim;

  private modelId: string | null = null;
  private loadingPromise: Promise<void> | null = null;
  /**
   * Serialises every `embed()`. The `embed-llamacpp` plugin allows one job per
   * model and throws "Cannot set new job: a job is already set or being
   * processed" if a second `embed()` is issued before the previous settles (its
   * README is explicit that callers must await the prior call). Several callers
   * share this one model — the agent's echo gate embeds a batch per reply, plus
   * publish and the "About you" re-embed — so we chain them through this tail
   * instead of letting them collide. Failures are swallowed from the chain so
   * one rejected call does not poison the queue for the next.
   */
  private queueTail: Promise<unknown> = Promise.resolve();

  get isLoaded(): boolean {
    return this.modelId !== null;
  }

  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }

  async load(onProgress?: EmbeddingProgressCallback): Promise<void> {
    if (this.modelId !== null) {
      return;
    }
    if (this.loadingPromise !== null) {
      return this.loadingPromise;
    }
    this.loadingPromise = this.doLoad(onProgress);
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.modelId === null) {
      return;
    }
    await unloadModel({ modelId: this.modelId });
    this.modelId = null;
  }

  async embed(text: string): Promise<Float32Array> {
    const modelId = await this.ensureLoaded();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('QvacEmbeddingService.embed: empty text');
    }
    const prompt = applyPromptTemplate(
      ModelProfiles.embedding.promptTemplate,
      trimmed,
    );
    // Serialise the actual SDK call: the model rejects a second in-flight job.
    return this.enqueue(async () => {
      const startedAt = Date.now();
      const result = (await embed({ modelId, text: prompt } as never)) as {
        embedding: number[];
      };
      auditInference('embedding.embed', {
        textChars: trimmed.length,
        dim: this.outputDim,
        ms: Date.now() - startedAt,
      });
      return postProcess(result.embedding, this.outputDim);
    });
  }

  /**
   * Append `task` to the serial embed queue and return its result. The tail is
   * advanced to a settled (never-rejecting) promise so a failing task does not
   * break the chain for subsequent callers.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(task, task);
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureLoaded(): Promise<string> {
    if (this.modelId === null) {
      await this.load();
    }
    if (this.modelId === null) {
      throw new Error('QvacEmbeddingService: model failed to load');
    }
    return this.modelId;
  }

  private async doLoad(onProgress?: EmbeddingProgressCallback): Promise<void> {
    // NOTE: decoder-only embedding models (e.g. Qwen3-Embedding) need
    // `modelConfig: ModelProfiles.embedding.loadConfig` ({ pooling: 'last',
    // attention: 'causal', device: 'cpu' on Android — the Adreno GPU path
    // segfaults). EmbeddingGemma is an encoder and loads on the GPU defaults,
    // so nothing extra is passed.
    const startedAt = Date.now();
    this.modelId = await loadWithFallback({
      primary: {
        modelSrc: ModelProfiles.embedding.url,
        modelType: 'llamacpp-embedding',
      },
      onProgress,
    });
    auditInference('embedding.load', {
      model: ModelProfiles.embedding.url,
      loadMs: Date.now() - startedAt,
    });
  }
}

/**
 * Apply the model's instruction template (if any), substituting `{text}`
 * with the input. EmbeddingGemma expects a task prompt; with no template
 * configured the raw text is embedded unchanged.
 */
function applyPromptTemplate(
  template: string | undefined,
  text: string,
): string {
  if (template === undefined || template.length === 0) {
    return text;
  }
  return template.replace('{text}', text);
}

function postProcess(raw: readonly number[], outputDim: number): Float32Array {
  const dim = Math.min(outputDim, raw.length);
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = raw[i] ?? 0;
  }
  return l2NormalizeInPlace(out);
}
