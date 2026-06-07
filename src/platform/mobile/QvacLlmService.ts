import { cancel, completion, unloadModel } from '@qvac/sdk';
import type { ModelProgressUpdate } from '@qvac/sdk';
import type { ILlmService, LlmGenerateOptions } from '@core/ports/ILlmService';
import { LlmConfig } from '@core/config/LlmConfig';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { loadWithFallback } from '../shared/LoadWithFallback';
import { auditInference } from '../shared/InferenceAudit';

/** Sentinel returned by the watchdog race when no token arrived in time. */
const WATCHDOG_TIMEOUT = Symbol('llm-watchdog-timeout');

/** Race `pending` against the watchdog timer. */
async function raceWatchdog<T>(
  pending: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof WATCHDOG_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<typeof WATCHDOG_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(WATCHDOG_TIMEOUT), timeoutMs);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

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
    auditInference('llm.unload', { model: ModelProfiles.llm.url });
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
    } as never) as { tokenStream: AsyncIterable<string> };

    // Manual iteration (no for-await): on a client-side stop or a watchdog
    // expiry we must cancel the worker-side request and DRAIN the stream to a
    // terminal state before returning. A bare `break` here let the worker keep
    // generating with the model held (observed live: a 21-minute completion),
    // while the serial queue advanced and the next call was rejected by QVAC's
    // registry concurrency policy.
    const iterator = result.tokenStream[Symbol.asyncIterator]();
    // The first token waits on the whole prefill, so it gets a wider budget
    // than the steady decode-time gap.
    let timeoutMs: number = LlmConfig.firstTokenTimeoutMs;
    // Audit-log measurements (evidence bundle): TTFT and decode rate. The
    // stream yields one token per iteration, so the chunk count IS the
    // completion token count.
    const startedAt = Date.now();
    let firstTokenAt: number | null = null;
    let tokenCount = 0;
    const emitAudit = (outcome: 'ok' | 'stop' | 'stalled'): void => {
      const endedAt = Date.now();
      const ttftMs = firstTokenAt === null ? null : firstTokenAt - startedAt;
      const decodeMs = firstTokenAt === null ? null : endedAt - firstTokenAt;
      auditInference('llm.completion', {
        outcome,
        promptChars: prompt.length,
        tokens: tokenCount,
        ttftMs,
        tokensPerSec:
          decodeMs !== null && decodeMs > 0 && tokenCount > 1
            ? Math.round(((tokenCount - 1) / decodeMs) * 1000 * 10) / 10
            : null,
        totalMs: endedAt - startedAt,
      });
    };
    while (true) {
      const next = await raceWatchdog(iterator.next(), timeoutMs);
      if (next === WATCHDOG_TIMEOUT) {
        this.cancelGeneration();
        await this.drainCancelled(iterator);
        emitAudit('stalled');
        throw new Error(
          `LLM generation stalled — no token for ${timeoutMs} ms; request cancelled`,
        );
      }
      if (next.done === true) {
        emitAudit('ok');
        return;
      }
      const token = next.value;
      if (firstTokenAt === null) {
        firstTokenAt = Date.now();
      }
      tokenCount += 1;
      if (options.stop !== undefined && options.stop.some((s) => token.includes(s))) {
        // `params.stop` is also passed to the worker, but it is not reliably
        // honoured — cancel explicitly so the model is freed now.
        this.cancelGeneration();
        await this.drainCancelled(iterator);
        emitAudit('stop');
        return;
      }
      onChunk(token);
      timeoutMs = LlmConfig.tokenGapTimeoutMs;
    }
  }

  /**
   * Consume a just-cancelled token stream until it ends, bounded by
   * `cancelDrainTimeoutMs`, so the serial queue only advances once the worker
   * has actually released the model. A cancelled stream may end with an error;
   * either way the request has reached a terminal state, so errors are
   * swallowed. If even the drain stalls we give up and let the queue move on.
   */
  private async drainCancelled(iterator: AsyncIterator<string>): Promise<void> {
    const drain = (async (): Promise<void> => {
      try {
        while (!(await iterator.next()).done) {
          // discard
        }
      } catch {
        // terminal state reached via error — fine
      }
    })();
    await raceWatchdog(drain, LlmConfig.cancelDrainTimeoutMs);
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
    const startedAt = Date.now();
    this.modelId = await loadWithFallback({
      primary: {
        modelSrc: ModelProfiles.llm.url,
        modelType: 'llm',
      },
      onProgress,
    });
    auditInference('llm.load', {
      model: ModelProfiles.llm.url,
      loadMs: Date.now() - startedAt,
    });
  }
}
