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
  readonly error?: string;
  readonly self?: PeerId;
}

export interface InboxState {
  readonly items: ReadonlyArray<ScoredPost>;
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
