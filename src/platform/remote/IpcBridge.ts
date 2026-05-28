/**
 * Type contract for `window.resonance` injected by the Electron preload
 * script (`electron/preload.cjs`). The renderer-side proxy ports call
 * `call('<port>', '<method>', args)` and receive structured-cloned
 * results. Event subscriptions are returned as unsubscribe closures.
 *
 * Keeping this interface in `src/platform/remote/` (not in `electron/`)
 * lets every consumer in the React tree depend on it via the standard
 * `@platform/*` alias without a cross-folder back-reach.
 */
export interface IpcBridge {
  call(port: string, method: string, args: ReadonlyArray<unknown>): Promise<unknown>;
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    readonly resonance?: IpcBridge;
  }
}

export function requireBridge(): IpcBridge {
  if (typeof window === 'undefined' || window.resonance === undefined) {
    throw new Error(
      'window.resonance not available — this build must run inside the Electron renderer ' +
        'with the resonance preload script attached.',
    );
  }
  return window.resonance;
}
