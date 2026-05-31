import type { AppContainer } from '@core/bootstrap/AppContainer';
import type { PostRepository } from '@data/PostRepository';
import type { ResponseRepository } from '@data/ResponseRepository';
import type { PeerRepository } from '@data/PeerRepository';
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
}

export interface PlatformContainer extends AppContainer {
  readonly posts: PostRepository;
  readonly responses: ResponseRepository;
  readonly peers: PeerRepository;
  readonly embedderConcrete: PlatformEmbeddingService;
  readonly llmConcrete: PlatformLlmService;
}
