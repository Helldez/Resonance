import { cancel, completion, deleteCache, unloadModel } from '@qvac/sdk';
import type { ModelProgressUpdate } from '@qvac/sdk';
import type { ILlmService, LlmGenerateOptions } from '@core/ports/ILlmService';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { loadWithFallback } from '@core/utils/LoadWithFallback';

export type LlmProgressCallback = (p: ModelProgressUpdate) => void;

/**
 * LLM service backed by QVAC's `llamacpp-completion` plugin. Streaming
 * uses the SDK's `tokenStream` async iterable.
 */
export class QvacLlmService implements ILlmService {
  private modelId: string | null = null;
  private loadingPromise: Promise<void> | null = null;
  /**
   * Serialises every completion. QVAC's registry allows only one completion
   * in flight per model and rejects the rest ("completion was rejected by
   * registry concurrency policy"). Several callers share this one model — the
   * agent tick, the map's topic-naming, the response-draft pipeline — and can
   * fire concurrently, so we chain calls through this tail instead of letting
   * them collide. Failures are swallowed from the chain so one rejected call
   * does not poison the queue for the next.
   */
  private queueTail: Promise<unknown> = Promise.resolve();

  get isLoaded(): boolean {
    return this.modelId !== null;
  }

  async initialize(): Promise<void> {
    // LLM load is deferred — only the embedding model is required at boot.
  }

  async load(onProgress?: LlmProgressCallback): Promise<void> {
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

  async complete(prompt: string, options: LlmGenerateOptions): Promise<string> {
    return this.enqueue(async () => {
      let acc = '';
      await this.streamRaw(prompt, options, (chunk) => {
        acc += chunk;
      });
      return acc;
    });
  }

  async completeStream(
    prompt: string,
    options: LlmGenerateOptions,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    await this.enqueue(() => this.streamRaw(prompt, options, onChunk));
  }

  /**
   * Append `task` to the serial completion queue and return its result. The
   * tail is advanced to a settled (never-rejecting) promise so a failing task
   * does not break the chain for subsequent callers.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(task, task);
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The actual single-flight SDK completion — only ever called via `enqueue`. */
  private async streamRaw(
    prompt: string,
    options: LlmGenerateOptions,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const modelId = await this.ensureLoaded();
    // A stable `system` turn keeps the persona prefix in the KV-cache configHash
    // so it is reused across calls sharing the same `kvCache` key.
    const history = options.system
      ? [
          { role: 'system', content: options.system },
          { role: 'user', content: prompt },
        ]
      : [{ role: 'user', content: prompt }];
    // The JSON schema is compiled to GBNF by llama.cpp and enforced while
    // decoding, so the model emits a valid object first-try.
    const responseFormat = options.responseSchema
      ? {
          type: 'json_schema',
          json_schema: { name: 'agent_payload', schema: options.responseSchema },
        }
      : undefined;
    const result = completion({
      modelId,
      history,
      stream: true,
      params: {
        temp: options.temperature,
        predict: options.maxTokens,
        stop: options.stop,
      },
      responseFormat,
      kvCache: options.kvCache,
    } as never) as { tokenStream: AsyncIterable<string> };

    for await (const token of result.tokenStream) {
      if (options.stop !== undefined && options.stop.some((s) => token.includes(s))) {
        break;
      }
      onChunk(token);
    }
  }

  /** Best-effort KV-cache cleanup for a persona session. Never throws. */
  async clearCache(kvCacheKey: string): Promise<void> {
    try {
      await deleteCache(
        (this.modelId === null
          ? { kvCacheKey }
          : { kvCacheKey, modelId: this.modelId }) as never,
      );
    } catch {
      // cache cleanup must never crash the agent loop
    }
  }

  cancelGeneration(): void {
    if (this.modelId === null) {
      return;
    }
    void cancel({ operation: 'inference', modelId: this.modelId } as never);
  }

  private async ensureLoaded(): Promise<string> {
    if (this.modelId === null) {
      await this.load();
    }
    if (this.modelId === null) {
      throw new Error('QvacLlmService: model failed to load');
    }
    return this.modelId;
  }

  private async doLoad(onProgress?: LlmProgressCallback): Promise<void> {
    this.modelId = await loadWithFallback({
      primary: {
        modelSrc: ModelProfiles.llm.url,
        modelType: 'llm',
      },
      onProgress,
    });
  }
}
