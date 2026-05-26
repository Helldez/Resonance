import { loadModel } from '@qvac/sdk';
import type { ModelProgressUpdate } from '@qvac/sdk';

/**
 * Wraps @qvac/sdk loadModel with a stall watchdog. The SDK handles the
 * actual download to disk; we just notice when progress freezes for too
 * long and surface a clear error.
 *
 * The optional `httpFallback` exists so a future `registry://` primary
 * source can degrade gracefully to HTTPS without touching call sites.
 */

const STALL_TIMEOUT_MS = 30_000;
const CHECK_INTERVAL_MS = 5_000;

export interface LoadModelArgs {
  readonly modelSrc: string;
  readonly modelType: string;
  readonly modelConfig?: Readonly<Record<string, unknown>>;
}

export interface LoadOptions {
  readonly primary: LoadModelArgs;
  readonly httpFallback?: LoadModelArgs;
  readonly onProgress?: (p: ModelProgressUpdate) => void;
}

export async function loadWithFallback(options: LoadOptions): Promise<string> {
  try {
    return await loadWithStallDetection(options.primary, options.onProgress);
  } catch (err) {
    const isStall = err instanceof Error && err.message === 'DOWNLOAD_STALLED';
    if (!isStall || options.httpFallback === undefined) {
      throw err;
    }
    return loadModel({ ...options.httpFallback, onProgress: options.onProgress } as never);
  }
}

function loadWithStallDetection(
  args: LoadModelArgs,
  onProgress?: (p: ModelProgressUpdate) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let lastProgressAt = Date.now();
    let settled = false;

    const stallChecker = setInterval(() => {
      if (settled) {
        return;
      }
      if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
        settled = true;
        clearInterval(stallChecker);
        reject(new Error('DOWNLOAD_STALLED'));
      }
    }, CHECK_INTERVAL_MS);

    const progressWrapper = (p: ModelProgressUpdate): void => {
      lastProgressAt = Date.now();
      onProgress?.(p);
    };

    (loadModel as (a: unknown) => Promise<string>)({
      ...args,
      onProgress: progressWrapper,
    }).then(
      (modelId) => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(stallChecker);
        resolve(modelId);
      },
      (err: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(stallChecker);
        reject(err);
      },
    );
  });
}
