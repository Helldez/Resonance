import type { PeerId, ScoredPost } from '@core/domain/types';

export interface BootstrapState {
  readonly stage:
    | 'idle'
    | 'identity'
    | 'embedding-model'
    | 'llm-model'
    | 'network'
    | 'ready'
    | 'error';
  readonly progressBytes?: number;
  readonly totalBytes?: number;
  /**
   * Whether the active model step is a first-time `download` (show byte
   * progress) or a `load` of an already-downloaded model (no MB). Undefined for
   * non-model steps.
   */
  readonly stepMode?: 'download' | 'load';
  readonly error?: string;
  readonly self?: PeerId;
}

export interface InboxState {
  readonly items: ReadonlyArray<ScoredPost>;
}

/**
 * Runtime state of the on-demand LLM model download, tracked globally so every
 * screen reflects the same live progress and a download started on one screen
 * (or during onboarding) keeps showing everywhere. Ephemeral — readiness is
 * re-derived from `llmConcrete.isLoaded` on each boot, so this is never
 * persisted.
 *
 * `preparing` is the post-download phase: the bytes have all arrived but the
 * native `load()` has not resolved yet (mmap + context init). Surfacing it
 * stops the bar from looking frozen at 100%.
 */
export interface ModelDownloadState {
  readonly status: 'idle' | 'downloading' | 'preparing' | 'ready' | 'error';
  readonly downloaded: number;
  readonly total: number;
  readonly error: string | null;
  /** Epoch ms when the current download began — feeds the indicator's ETA. */
  readonly startedAt: number | null;
}

export interface SettingsState {
  readonly receiverContext: string;
  readonly similarityThreshold: number;
  /**
   * Local-only display name. Never published in signed records; visible
   * only to the user themselves. Falls back to a truncated peer id when
   * empty. Remote peers are always rendered by their truncated peer id
   * in Phase 1.
   */
  readonly displayName: string;
  /** True once the first-run onboarding flow has been completed (or skipped). */
  readonly onboardingDone: boolean;
}
