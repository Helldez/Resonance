import { create } from 'zustand';
import type { ModelProgressUpdate } from '@qvac/sdk';
import type { PlatformContainer } from '@platform/PlatformContainer';
import type { ModelDownloadState } from './types';

type ModelDownloadStore = ModelDownloadState & {
  /**
   * Begin (or resume the UI of) the LLM download. Guarded so calling it from
   * several screens never starts a second download: the QVAC service is itself
   * single-flight, and this store dedupes at the UI layer. A no-op unless the
   * status is `idle` or `error` (the latter allows retry).
   */
  start: (container: PlatformContainer | null) => void;
  /** Reconcile status from the container once it becomes available. */
  syncReady: (container: PlatformContainer) => void;
};

const INITIAL: ModelDownloadState = {
  status: 'idle',
  downloaded: 0,
  total: 0,
  error: null,
  startedAt: null,
};

/**
 * Single source of truth for the on-demand LLM download. Mirrors the
 * `BootstrapStore` pattern (plain `create`, no `persist` — see
 * `ModelDownloadState`). Screens subscribe with narrow selectors so a screen
 * that only cares about ready/not-ready does not re-render on every progress
 * tick.
 */
export const useModelDownloadStore = create<ModelDownloadStore>((set, get) => ({
  ...INITIAL,

  start: (container) => {
    if (container === null) {
      return;
    }
    const { status } = get();
    if (status === 'downloading' || status === 'preparing' || status === 'ready') {
      return;
    }
    if (container.llmConcrete.isLoaded) {
      set({ status: 'ready', error: null });
      return;
    }

    set({
      status: 'downloading',
      downloaded: 0,
      total: 0,
      error: null,
      startedAt: Date.now(),
    });

    const onProgress = (p: ModelProgressUpdate): void => {
      const downloaded = p.downloaded ?? 0;
      const total = p.total ?? 0;
      // All bytes in but the native load hasn't resolved: enter `preparing`
      // so the UI shows a full bar with a "finalizing" label, not a stall.
      const reachedEnd = total > 0 && downloaded >= total;
      set({ status: reachedEnd ? 'preparing' : 'downloading', downloaded, total });
    };

    void (async () => {
      try {
        await container.llmConcrete.load(onProgress);
        set({ status: 'ready', error: null });
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
  },

  syncReady: (container) => {
    if (container.llmConcrete.isLoaded) {
      set({ status: 'ready', error: null });
    }
  },
}));
