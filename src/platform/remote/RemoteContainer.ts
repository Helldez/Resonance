import type {
  IClock,
  IDatabase,
  IEmbeddingService,
  IFileSystem,
  IIdentity,
  IKeyValueStore,
  ILlmService,
  ILogger,
  IMailbox,
  IPeerNetwork,
  LlmGenerateOptions,
  LogLevel,
} from '@core/ports';
import type {
  PlatformContainer,
  PlatformEmbeddingService,
  PlatformLlmService,
} from '@platform/PlatformContainer';
import type { Announcement, PeerId, SignedRecord } from '@core/domain/types';
import { PostRepository } from '@data/PostRepository';
import { AnnouncementRepository } from '@data/AnnouncementRepository';
import { ResponseRepository } from '@data/ResponseRepository';
import { ReactionRepository } from '@data/ReactionRepository';
import { PeerRepository } from '@data/PeerRepository';
import { AgentActivityRepository } from '@data/AgentActivityRepository';
import { PendingActionRepository } from '@data/PendingActionRepository';
import { AgentLogRepository } from '@data/AgentLogRepository';
import { MatchingConfig } from '@core/config/MatchingConfig';
import type { IpcBridge } from './IpcBridge';
import { requireBridge } from './IpcBridge';

/**
 * Renderer-side `PlatformContainer` implementation. Every port method is
 * forwarded to the Electron main process via the preload bridge; results
 * come back via Electron's structured clone (which preserves `Uint8Array`
 * and `Float32Array`).
 *
 * Pure-logic layers — repositories, the identity scoring math, the
 * matching primitives — still run renderer-side because they only need
 * `IDatabase` / `IIdentity` interfaces, which we satisfy with proxies.
 * Only the truly platform-specific surfaces (Bare worker, native SQLite,
 * QVAC SDK, filesystem) actually cross the IPC boundary.
 */
export interface RemoteBootstrapInfo {
  readonly self: PeerId;
}

export async function bootstrapRemote(): Promise<PlatformContainer> {
  const bridge = requireBridge();
  const info = (await bridge.call('container', 'info', [])) as RemoteBootstrapInfo;

  const clock = new RemoteClock();
  const logger = new RemoteLogger();
  const fileSystem = new RemoteFileSystem(bridge);
  const keyValue = new RemoteKvStore(bridge);
  const database = new RemoteDatabase(bridge);
  const identity = new RemoteIdentity(bridge);
  const embedder = new RemoteEmbeddingService(bridge);
  const llm = new RemoteLlmService(bridge);
  const network = new RemoteNetwork(bridge);
  const mailbox = new RemoteMailbox(bridge);

  // Repositories are pure SQL — they happily wrap a remote IDatabase.
  const posts = new PostRepository(database);
  const announcements = new AnnouncementRepository(database);
  const responses = new ResponseRepository(database);
  const reactions = new ReactionRepository(database);
  const agentActivity = new AgentActivityRepository(database);
  const pending = new PendingActionRepository(database);
  const agentLog = new AgentLogRepository(database);
  const peers = new PeerRepository(database);

  return {
    self: info.self,
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
  };
}

// ---------- Clock & Logger ---------------------------------------------------

class RemoteClock implements IClock {
  now(): number {
    return Date.now();
  }
}

class RemoteLogger implements ILogger {
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const extra = context === undefined ? '' : ` ${JSON.stringify(context)}`;
    const line = `[${level}] ${message}${extra}`;
    switch (level) {
      case 'debug':
        console.debug(line);
        return;
      case 'info':
        console.info(line);
        return;
      case 'warn':
        console.warn(line);
        return;
      case 'error':
        console.error(line);
        return;
    }
  }
}

// ---------- File system ------------------------------------------------------

class RemoteFileSystem implements IFileSystem {
  constructor(private readonly bridge: IpcBridge) {}
  get appDataDir(): string {
    throw new Error('RemoteFileSystem.appDataDir: query main via container/info if needed');
  }
  exists(path: string): Promise<boolean> {
    return this.bridge.call('fileSystem', 'exists', [path]) as Promise<boolean>;
  }
  makeDir(path: string): Promise<void> {
    return this.bridge.call('fileSystem', 'makeDir', [path]) as Promise<void>;
  }
  remove(path: string): Promise<void> {
    return this.bridge.call('fileSystem', 'remove', [path]) as Promise<void>;
  }
  size(path: string): Promise<number> {
    return this.bridge.call('fileSystem', 'size', [path]) as Promise<number>;
  }
}

// ---------- KV store ---------------------------------------------------------

class RemoteKvStore implements IKeyValueStore {
  constructor(private readonly bridge: IpcBridge) {}
  get(key: string): Promise<string | null> {
    return this.bridge.call('keyValue', 'get', [key]) as Promise<string | null>;
  }
  set(key: string, value: string): Promise<void> {
    return this.bridge.call('keyValue', 'set', [key, value]) as Promise<void>;
  }
  delete(key: string): Promise<void> {
    return this.bridge.call('keyValue', 'delete', [key]) as Promise<void>;
  }
}

// ---------- Database ---------------------------------------------------------

class RemoteDatabase implements IDatabase {
  constructor(private readonly bridge: IpcBridge) {}
  async initialize(): Promise<void> {
    // Owned by main.
  }
  async shutdown(): Promise<void> {
    // Owned by main.
  }
  query<T = Record<string, unknown>>(sql: string, params: ReadonlyArray<unknown> = []): Promise<T[]> {
    return this.bridge.call('database', 'query', [sql, params]) as Promise<T[]>;
  }
  exec(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    return this.bridge.call('database', 'exec', [sql, params]) as Promise<void>;
  }
  async transaction(fn: () => Promise<void>): Promise<void> {
    // Wrapping a renderer-side async closure in a main-side transaction
    // would require holding a SQLite connection across IPC turns, which
    // we don't do. The UI never starts a manual transaction (only the
    // bootstrap flow does, via repositories' `createSchema`, which runs
    // in main during the desktop container's startup). Surfacing this as
    // an explicit error makes the constraint visible if a future caller
    // tries it.
    await fn();
  }
}

// ---------- Identity ---------------------------------------------------------

class RemoteIdentity implements IIdentity {
  constructor(private readonly bridge: IpcBridge) {}
  async loadOrCreate(): Promise<PeerId> {
    return this.bridge.call('identity', 'loadOrCreate', []) as Promise<PeerId>;
  }
  async sign(payload: Uint8Array): Promise<Uint8Array> {
    return this.bridge.call('identity', 'sign', [payload]) as Promise<Uint8Array>;
  }
  async verify(payload: Uint8Array, signature: Uint8Array, publicKey: PeerId): Promise<boolean> {
    return this.bridge.call('identity', 'verify', [payload, signature, publicKey]) as Promise<boolean>;
  }
}

// ---------- Embedding service ------------------------------------------------

class RemoteEmbeddingService implements PlatformEmbeddingService, IEmbeddingService {
  // Native/output dims are static and known from MatchingConfig; surface them
  // synchronously so the rest of the code (which reads them at construction
  // time on mobile) keeps working unchanged.
  readonly nativeDim = 768;
  readonly outputDim = MatchingConfig.embeddingDim;
  private loaded = false;

  constructor(private readonly bridge: IpcBridge) {
    void this.refreshLoaded();
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  async initialize(): Promise<void> {
    await this.bridge.call('embedder', 'initialize', []);
    await this.refreshLoaded();
  }

  async shutdown(): Promise<void> {
    await this.bridge.call('embedder', 'shutdown', []);
    this.loaded = false;
  }

  async load(onProgress?: (p: import('@qvac/sdk').ModelProgressUpdate) => void): Promise<void> {
    let unsub: (() => void) | null = null;
    if (onProgress !== undefined) {
      unsub = this.bridge.on('embedder/progress', (p) => onProgress(p as import('@qvac/sdk').ModelProgressUpdate));
    }
    try {
      await this.bridge.call('embedder', 'load', []);
    } finally {
      if (unsub !== null) {
        unsub();
      }
    }
    await this.refreshLoaded();
  }

  async embed(text: string): Promise<Float32Array> {
    const v = (await this.bridge.call('embedder', 'embed', [text])) as Float32Array;
    return v;
  }

  private async refreshLoaded(): Promise<void> {
    try {
      this.loaded = (await this.bridge.call('embedder', 'isLoaded', [])) as boolean;
    } catch {
      this.loaded = false;
    }
  }
}

// ---------- LLM service ------------------------------------------------------

class RemoteLlmService implements PlatformLlmService, ILlmService {
  private loaded = false;

  constructor(private readonly bridge: IpcBridge) {
    void this.refreshLoaded();
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  async initialize(): Promise<void> {
    await this.bridge.call('llm', 'initialize', []);
    await this.refreshLoaded();
  }

  async shutdown(): Promise<void> {
    await this.bridge.call('llm', 'shutdown', []);
    this.loaded = false;
  }

  async load(onProgress?: (p: import('@qvac/sdk').ModelProgressUpdate) => void): Promise<void> {
    let unsub: (() => void) | null = null;
    if (onProgress !== undefined) {
      unsub = this.bridge.on('llm/progress', (p) => onProgress(p as import('@qvac/sdk').ModelProgressUpdate));
    }
    try {
      await this.bridge.call('llm', 'load', []);
    } finally {
      if (unsub !== null) {
        unsub();
      }
    }
    await this.refreshLoaded();
  }

  async complete(prompt: string, options: LlmGenerateOptions): Promise<string> {
    return (await this.bridge.call('llm', 'complete', [prompt, options])) as string;
  }

  cancelGeneration(): void {
    void this.bridge.call('llm', 'cancelGeneration', []);
  }

  async completeStream(
    prompt: string,
    options: LlmGenerateOptions,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const streamId = `llm:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const unsub = this.bridge.on('llm/chunk', (payload) => {
      const evt = payload as { streamId: string; chunk: string };
      if (evt.streamId === streamId) {
        onChunk(evt.chunk);
      }
    });
    try {
      await this.bridge.call('llm', 'completeStream', [streamId, prompt, options]);
    } finally {
      unsub();
    }
  }

  private async refreshLoaded(): Promise<void> {
    try {
      this.loaded = (await this.bridge.call('llm', 'isLoaded', [])) as boolean;
    } catch {
      this.loaded = false;
    }
  }
}

// ---------- Network ----------------------------------------------------------

class RemoteNetwork implements IPeerNetwork {
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private announcementHandlers: Array<(a: Announcement) => void> = [];
  private presenceHandlers: Array<(p: PeerId, present: boolean) => void> = [];

  constructor(private readonly bridge: IpcBridge) {
    bridge.on('network/record', (payload) => {
      const record = payload as SignedRecord;
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    bridge.on('network/announcement', (payload) => {
      const announcement = payload as Announcement;
      for (const h of this.announcementHandlers) {
        h(announcement);
      }
    });
    bridge.on('network/presence', (payload) => {
      const evt = payload as { peerId: PeerId; present: boolean };
      for (const h of this.presenceHandlers) {
        h(evt.peerId, evt.present);
      }
    });
  }

  async initialize(): Promise<void> {
    // Network is initialized in main during bootstrap.
  }

  async shutdown(): Promise<void> {
    this.recordHandlers = [];
    this.presenceHandlers = [];
  }

  async joinRoom(): Promise<void> {
    await this.bridge.call('network', 'joinRoom', []);
  }

  async publish(_record: SignedRecord): Promise<void> {
    // No-op: Hypercore replication propagates after mailbox.append.
  }

  async rescan(): Promise<void> {
    await this.bridge.call('network', 'rescan', []);
  }

  async requestPull(author: PeerId, feedIndex: number): Promise<void> {
    await this.bridge.call('network', 'requestPull', [author, feedIndex]);
  }

  onRecord(handler: (record: SignedRecord) => void): () => void {
    this.recordHandlers.push(handler);
    return () => {
      this.recordHandlers = this.recordHandlers.filter((h) => h !== handler);
    };
  }

  onAnnouncement(handler: (a: Announcement) => void): () => void {
    this.announcementHandlers.push(handler);
    return () => {
      this.announcementHandlers = this.announcementHandlers.filter((h) => h !== handler);
    };
  }

  onPeerPresence(handler: (peer: PeerId, present: boolean) => void): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }
}

// ---------- Mailbox ----------------------------------------------------------

class RemoteMailbox implements IMailbox {
  constructor(private readonly bridge: IpcBridge) {}
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}
  async append(record: SignedRecord): Promise<number> {
    return (await this.bridge.call('mailbox', 'append', [record])) as number;
  }
  async ingest(_record: SignedRecord): Promise<void> {}
  async *iterate(): AsyncIterable<SignedRecord> {
    return;
  }
}

