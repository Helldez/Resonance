import type { IClock } from '@core/ports/IClock';
import type { IDatabase } from '@core/ports/IDatabase';
import type { IFileSystem } from '@core/ports/IFileSystem';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IKeyValueStore } from '@core/ports/IKeyValueStore';
import type { ILogger } from '@core/ports/ILogger';
import { bootstrapIdentity } from '@core/identity/IdentityManager';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { PostRepository } from '@data/PostRepository';
import { AnnouncementRepository } from '@data/AnnouncementRepository';
import { ResponseRepository } from '@data/ResponseRepository';
import { ReactionRepository } from '@data/ReactionRepository';
import { PeerRepository } from '@data/PeerRepository';
import { AgentActivityRepository } from '@data/AgentActivityRepository';
import { PendingActionRepository } from '@data/PendingActionRepository';
import { AgentLogRepository } from '@data/AgentLogRepository';
import type {
  PlatformContainer,
  PlatformEmbeddingService,
  PlatformLlmService,
} from '@platform/PlatformContainer';
import { P2pWorker } from './P2pWorker';
import { P2pNetwork } from './P2pNetwork';
import { P2pMailbox } from './P2pMailbox';
import type { RpcTransportHandle } from './RpcTransport';

/**
 * A fully-wired container for a target that hosts the Bare P2P worker
 * locally (mobile worklet or desktop subprocess). The `p2p` handle is not
 * part of the UI-facing `PlatformContainer` surface — it is kept on the
 * concrete container only for lifecycle (shutdown) by the platform host.
 */
export type LocalContainer = PlatformContainer & {
  readonly p2p: P2pWorker;
};

/** Concrete adapters each target constructs before calling `wireContainer`. */
export interface ContainerAdapters {
  readonly logger: ILogger;
  readonly clock: IClock;
  readonly fileSystem: IFileSystem;
  readonly keyValue: IKeyValueStore;
  readonly database: IDatabase;
  readonly identity: IIdentity;
  readonly embedder: PlatformEmbeddingService;
  readonly llm: PlatformLlmService;
  /** How to start/stop the channel to the Bare P2P worker. */
  readonly transport: RpcTransportHandle;
  /** Absolute path to the Corestore directory on disk. */
  readonly storagePath: string;
}

/**
 * Single shared wiring sequence for mobile and desktop: initialize the
 * database, build every repository (with schema + embedding-dim guard),
 * bootstrap the identity, start the P2P worker over the injected transport,
 * and assemble the container. The per-target bootstraps only construct
 * concrete adapters and delegate here.
 */
export async function wireContainer(a: ContainerAdapters): Promise<LocalContainer> {
  await a.database.initialize();

  const posts = new PostRepository(a.database);
  await posts.createSchema();
  const droppedPosts = await posts.dropIfDimChanged(MatchingConfig.embeddingDim);
  if (droppedPosts > 0) {
    a.logger.log(
      'warn',
      `dropped ${droppedPosts} posts: stored embedding dim incompatible with current model (expected ${MatchingConfig.embeddingDim}-dim)`,
    );
  }
  const announcements = new AnnouncementRepository(a.database);
  await announcements.createSchema();
  const responses = new ResponseRepository(a.database);
  await responses.createSchema();
  const reactions = new ReactionRepository(a.database);
  await reactions.createSchema();
  const agentActivity = new AgentActivityRepository(a.database);
  await agentActivity.createSchema();
  const pending = new PendingActionRepository(a.database);
  await pending.createSchema();
  const agentLog = new AgentLogRepository(a.database);
  await agentLog.createSchema();
  const peers = new PeerRepository(a.database);
  await peers.createSchema();

  const { self } = await bootstrapIdentity({ identity: a.identity });

  const p2p = new P2pWorker({ transport: a.transport, storagePath: a.storagePath });
  const network = new P2pNetwork(p2p);
  await network.initialize();
  const mailbox = new P2pMailbox(p2p);
  await mailbox.initialize();

  return {
    self,
    clock: a.clock,
    logger: a.logger,
    fileSystem: a.fileSystem,
    keyValue: a.keyValue,
    database: a.database,
    identity: a.identity,
    embedder: a.embedder,
    llm: a.llm,
    network,
    mailbox,
    posts,
    announcements,
    responses,
    reactions,
    agentActivity,
    pending,
    agentLog,
    peers,
    embedderConcrete: a.embedder,
    llmConcrete: a.llm,
    p2p,
  };
}
