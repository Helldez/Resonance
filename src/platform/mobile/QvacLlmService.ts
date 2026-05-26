import { cancel, completion, unloadModel } from '@qvac/sdk';
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
    let acc = '';
    await this.completeStream(prompt, options, (chunk) => {
      acc += chunk;
    });
    return acc;
  }

  async completeStream(
    prompt: string,
    options: LlmGenerateOptions,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const modelId = await this.ensureLoaded();
    const result = completion({
      modelId,
      history: [{ role: 'user', content: prompt }],
      stream: true,
      params: {
        temp: options.temperature,
        predict: options.maxTokens,
        stop: options.stop,
      },
    } as never) as { tokenStream: AsyncIterable<string> };

    for await (const token of result.tokenStream) {
      if (options.stop !== undefined && options.stop.some((s) => token.includes(s))) {
        break;
      }
      onChunk(token);
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
