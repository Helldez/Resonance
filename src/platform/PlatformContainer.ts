import type { AppContainer } from '@core/bootstrap/AppContainer';
import type { PostRepository } from '@data/PostRepository';
import type { AnnouncementRepository } from '@data/AnnouncementRepository';
import type { ResponseRepository } from '@data/ResponseRepository';
import type { ReactionRepository } from '@data/ReactionRepository';
import type { PeerRepository } from '@data/PeerRepository';
import type { AgentActivityRepository } from '@data/AgentActivityRepository';
import type { PendingActionRepository } from '@data/PendingActionRepository';
import type { AgentLogRepository } from '@data/AgentLogRepository';
import type { IEmbeddingService, ILlmService } from '@core/ports';
import type { ModelProgressUpdate } from '@qvac/sdk';

/**
 * Shape that the UI layer expects from any platform-specific container.
 * Mobile (`MobileContainer`) and desktop renderer (`RemoteContainer`) both
 * conform to this so screens stay platform-agnostic.
 */

/** Embedding service plus model-lifecycle bits the settings UI exposes. */
export interface PlatformEmbeddingService extends IEmbeddingService {
  readonly isLoaded: boolean;
  load(onProgress?: (p: ModelProgressUpdate) => void): Promise<void>;
}

/** LLM service plus model-lifecycle bits the settings UI exposes. */
export interface PlatformLlmService extends ILlmService {
  readonly isLoaded: boolean;
  load(onProgress?: (p: ModelProgressUpdate) => void): Promise<void>;
  /**
   * Abort the in-flight generation (if any), freeing the model immediately.
   * Used by the agent kill switch: gating future ticks is not enough when a
   * completion can hold the model for minutes.
   */
  cancelGeneration(): void;
}

export interface PlatformContainer extends AppContainer {
  readonly posts: PostRepository;
  readonly announcements: AnnouncementRepository;
  readonly responses: ResponseRepository;
  readonly reactions: ReactionRepository;
  readonly peers: PeerRepository;
  readonly agentActivity: AgentActivityRepository;
  readonly pending: PendingActionRepository;
  readonly agentLog: AgentLogRepository;
  readonly embedderConcrete: PlatformEmbeddingService;
  readonly llmConcrete: PlatformLlmService;
}
