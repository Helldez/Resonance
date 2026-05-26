import type { PeerId } from '@core/domain/types';
import type { IClock } from '@core/ports/IClock';
import type { IDatabase } from '@core/ports/IDatabase';
import type { IEmbeddingService } from '@core/ports/IEmbeddingService';
import type { IFileSystem } from '@core/ports/IFileSystem';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IKeyValueStore } from '@core/ports/IKeyValueStore';
import type { ILlmService } from '@core/ports/ILlmService';
import type { ILogger } from '@core/ports/ILogger';
import type { IMailbox } from '@core/ports/IMailbox';
import type { IModelRegistry } from '@core/ports/IModelRegistry';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';

/**
 * The set of port instances the platform layer assembles at startup and
 * hands to the core. The core only sees this interface — never concrete
 * adapter classes.
 */
export interface AppContainer {
  readonly self: PeerId;
  readonly clock: IClock;
  readonly logger: ILogger;
  readonly fileSystem: IFileSystem;
  readonly keyValue: IKeyValueStore;
  readonly database: IDatabase;
  readonly identity: IIdentity;
  readonly modelRegistry: IModelRegistry;
  readonly embedder: IEmbeddingService;
  readonly llm: ILlmService;
  readonly network: IPeerNetwork;
  readonly mailbox: IMailbox;
}
