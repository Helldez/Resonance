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

export type ResponseMode = 'draft-confirm' | 'auto-publish';

export interface SettingsState {
  readonly responseMode: ResponseMode;
  readonly receiverContext: string;
  readonly similarityThreshold: number;
}
