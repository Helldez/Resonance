// crypto.getRandomValues polyfill — Hermes does not implement the Web Crypto
// API; @noble/ed25519 v2 needs crypto.getRandomValues for randomPrivateKey().
// Must be the very first import so it's installed before any code uses it.
import 'react-native-get-random-values';

// Buffer polyfill — @qvac/sdk pulls in bare-rpc → bare-stream which calls
// Buffer.from(...) unconditionally. Hermes has TextEncoder but NOT Buffer,
// so SDK calls crash without this polyfill. Must run before any @qvac/sdk
// import is evaluated downstream.
import { Buffer } from 'buffer';
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

import { Paths } from 'expo-file-system';
import type { AppContainer } from '@core/bootstrap/AppContainer';
import { AsyncStorageKv } from './AsyncStorageKv';
import { ConsoleLogger } from './ConsoleLogger';
import { Ed25519Identity } from './Ed25519Identity';
import { ExpoFileSystem } from './ExpoFileSystem';
import { ExpoSqliteDatabase } from './ExpoSqliteDatabase';
import { WorkletTransport } from './WorkletTransport';
import { P2pWorker } from '@platform/shared/P2pWorker';
import { P2pNetwork } from '@platform/shared/P2pNetwork';
import { P2pMailbox } from '@platform/shared/P2pMailbox';
import { QvacEmbeddingService } from './QvacEmbeddingService';
import { QvacLlmService } from './QvacLlmService';
import { SystemClock } from './SystemClock';
import { bootstrapIdentity } from '@core/identity/IdentityManager';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { StorageConfig } from '@core/config/StorageConfig';
import { PostRepository } from '@data/PostRepository';
import { AnnouncementRepository } from '@data/AnnouncementRepository';
import { ResponseRepository } from '@data/ResponseRepository';
import { ReactionRepository } from '@data/ReactionRepository';
import { PeerRepository } from '@data/PeerRepository';
import { AgentActivityRepository } from '@data/AgentActivityRepository';
import { PendingActionRepository } from '@data/PendingActionRepository';
import { AgentLogRepository } from '@data/AgentLogRepository';

export interface MobileContainer extends AppContainer {
  readonly posts: PostRepository;
  readonly announcements: AnnouncementRepository;
  readonly responses: ResponseRepository;
  readonly reactions: ReactionRepository;
  readonly peers: PeerRepository;
  readonly agentActivity: AgentActivityRepository;
  readonly pending: PendingActionRepository;
  readonly agentLog: AgentLogRepository;
  readonly embedderConcrete: QvacEmbeddingService;
  readonly llmConcrete: QvacLlmService;
  /**
   * The Bare worker handle. Not part of the shared `PlatformContainer`
   * surface (the UI never touches it) — kept on the concrete container only
   * for lifecycle (shutdown) by the platform host.
   */
  readonly p2p: P2pWorker;
}

let cached: MobileContainer | null = null;

/**
 * Single place where concrete adapters are instantiated and wired into a
 * container. Idempotent.
 */
export async function bootstrapMobile(): Promise<MobileContainer> {
  if (cached !== null) {
    return cached;
  }
  const logger = new ConsoleLogger();
  const clock = new SystemClock();
  const fileSystem = new ExpoFileSystem();
  const keyValue = new AsyncStorageKv();
  const database = new ExpoSqliteDatabase();
  await database.initialize();

  const posts = new PostRepository(database);
  await posts.createSchema();
  const droppedPosts = await posts.dropIfDimChanged(MatchingConfig.embeddingDim);
  if (droppedPosts > 0) {
    logger.log(
      'warn',
      `dropped ${droppedPosts} posts: stored embedding dim incompatible with current model (expected ${MatchingConfig.embeddingDim}-dim)`,
    );
  }
  const announcements = new AnnouncementRepository(database);
  await announcements.createSchema();
  const responses = new ResponseRepository(database);
  await responses.createSchema();
  const reactions = new ReactionRepository(database);
  await reactions.createSchema();
  const agentActivity = new AgentActivityRepository(database);
  await agentActivity.createSchema();
  const pending = new PendingActionRepository(database);
  await pending.createSchema();
  const agentLog = new AgentLogRepository(database);
  await agentLog.createSchema();
  const peers = new PeerRepository(database);
  await peers.createSchema();

  const identity = new Ed25519Identity(keyValue);
  const { self } = await bootstrapIdentity({ identity });

  const embedder = new QvacEmbeddingService();
  const llm = new QvacLlmService();

  // Corestore lives under the app's document directory; Bare wants a plain
  // filesystem path, so strip the file:// scheme expo-file-system reports.
  const docUri = Paths.document.uri;
  const docPath = docUri.startsWith('file://') ? docUri.slice('file://'.length) : docUri;
  const storagePath = `${docPath}${StorageConfig.corestoreDir}`;

  const p2p = new P2pWorker({ transport: new WorkletTransport(), storagePath });
  const network = new P2pNetwork(p2p);
  await network.initialize();
  const mailbox = new P2pMailbox(p2p);
  await mailbox.initialize();

  cached = {
    self,
    clock,
    logger,
    fileSystem,
    keyValue,
    database,
    identity,
    embedder,
    llm,
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
    embedderConcrete: embedder,
    llmConcrete: llm,
    p2p,
  };
  return cached;
}

export function getContainer(): MobileContainer {
  if (cached === null) {
    throw new Error('bootstrapMobile has not finished yet');
  }
  return cached;
}
