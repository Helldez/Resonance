import { join } from 'node:path';
import type { AppContainer } from '@core/bootstrap/AppContainer';
import { DesktopConfig } from './DesktopConfig';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { StorageConfig } from '@core/config/StorageConfig';
import { bootstrapIdentity } from '@core/identity/IdentityManager';
import { PostRepository } from '@data/PostRepository';
import { AnnouncementRepository } from '@data/AnnouncementRepository';
import { ResponseRepository } from '@data/ResponseRepository';
import { ReactionRepository } from '@data/ReactionRepository';
import { PeerRepository } from '@data/PeerRepository';
import { AgentActivityRepository } from '@data/AgentActivityRepository';
import { PendingActionRepository } from '@data/PendingActionRepository';
import { AgentLogRepository } from '@data/AgentLogRepository';

import { ConsoleLogger } from './ConsoleLogger';
import { DesktopMailbox } from './DesktopMailbox';
import { DesktopNetwork } from './DesktopNetwork';
import { DesktopP2pWorker } from './DesktopP2pWorker';
import { Ed25519Identity } from './Ed25519Identity';
import { NodeFileSystem } from './NodeFileSystem';
import { NodeKvStore } from './NodeKvStore';
import { NodeSqliteDatabase } from './NodeSqliteDatabase';
import { QvacEmbeddingService } from './QvacEmbeddingService';
import { QvacLlmService } from './QvacLlmService';
import { SystemClock } from './SystemClock';

export interface DesktopContainer extends AppContainer {
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
   * for lifecycle (shutdown) by the Electron host.
   */
  readonly p2p: DesktopP2pWorker;
}

export interface DesktopBootstrapOptions {
  /**
   * Absolute path to the directory where user data (DB, corestore, KV,
   * keypair) is persisted. Provided by the caller so this layer never
   * hardcodes an OS-specific path.
   */
  readonly appDataDir: string;
  /** Absolute path to the Bare desktop entry file. */
  readonly bareEntryPath: string;
}

let cached: DesktopContainer | null = null;

/**
 * Single place where the concrete desktop adapters are instantiated and
 * wired into a container. Idempotent: subsequent calls return the same
 * instance (useful when both the Electron main process and a dev REPL
 * import it).
 */
export async function bootstrapDesktop(
  options: DesktopBootstrapOptions,
): Promise<DesktopContainer> {
  if (cached !== null) {
    return cached;
  }

  const logger = new ConsoleLogger();
  const clock = new SystemClock();

  const fileSystem = new NodeFileSystem(options.appDataDir);
  await fileSystem.makeDir(options.appDataDir);
  await fileSystem.makeDir(fileSystem.resolve(StorageConfig.modelsDir));
  const corestoreDir = fileSystem.resolve(StorageConfig.corestoreDir);
  await fileSystem.makeDir(corestoreDir);

  const keyValue = new NodeKvStore(
    fileSystem.resolve(DesktopConfig.kvStoreFile),
  );
  const database = new NodeSqliteDatabase(
    fileSystem.resolve(DesktopConfig.databaseFile),
  );
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

  const p2p = new DesktopP2pWorker({
    entryPath: options.bareEntryPath,
    storagePath: corestoreDir,
  });
  const network = new DesktopNetwork(p2p);
  await network.initialize();
  const mailbox = new DesktopMailbox(p2p);
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

export function getDesktopContainer(): DesktopContainer {
  if (cached === null) {
    throw new Error('bootstrapDesktop has not finished yet');
  }
  return cached;
}

/**
 * Default OS-specific app-data root. Resolves to
 *   - Windows: %APPDATA%/<DesktopConfig.appFolderName>
 *   - macOS:   ~/Library/Application Support/<DesktopConfig.appFolderName>
 *   - Linux:   $XDG_DATA_HOME/<...>  or  ~/.local/share/<...>
 *
 * Callers (CLI peer, Electron main) decide whether to use this default or
 * provide their own (Electron passes `app.getPath('userData')`).
 */
export function defaultAppDataDir(homeDir: string, platform: NodeJS.Platform): string {
  const folder = DesktopConfig.appFolderName;
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (typeof appData === 'string' && appData.length > 0) {
      return join(appData, folder);
    }
    return join(homeDir, 'AppData', 'Roaming', folder);
  }
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', folder);
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (typeof xdg === 'string' && xdg.length > 0) {
    return join(xdg, folder);
  }
  return join(homeDir, '.local', 'share', folder);
}
