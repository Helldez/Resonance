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

import type { AppContainer } from '@core/bootstrap/AppContainer';
import { AsyncStorageKv } from './AsyncStorageKv';
import { BareWorkletMailbox } from './BareWorkletMailbox';
import { BareWorkletNetwork } from './BareWorkletNetwork';
import { ConsoleLogger } from './ConsoleLogger';
import { Ed25519Identity } from './Ed25519Identity';
import { ExpoFileSystem } from './ExpoFileSystem';
import { ExpoSqliteDatabase } from './ExpoSqliteDatabase';
import { P2pWorklet } from './P2pWorklet';
import { QvacEmbeddingService } from './QvacEmbeddingService';
import { QvacLlmService } from './QvacLlmService';
import { SystemClock } from './SystemClock';
import { bootstrapIdentity } from '@core/identity/IdentityManager';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { PostRepository } from '@data/PostRepository';
import { ResponseRepository } from '@data/ResponseRepository';
import { PeerRepository } from '@data/PeerRepository';

export interface MobileContainer extends AppContainer {
  readonly posts: PostRepository;
  readonly responses: ResponseRepository;
  readonly peers: PeerRepository;
  readonly embedderConcrete: QvacEmbeddingService;
  readonly llmConcrete: QvacLlmService;
  readonly p2p: P2pWorklet;
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
  const responses = new ResponseRepository(database);
  await responses.createSchema();
  const peers = new PeerRepository(database);
  await peers.createSchema();

  const identity = new Ed25519Identity(keyValue);
  const { self } = await bootstrapIdentity({ identity });

  const embedder = new QvacEmbeddingService();
  const llm = new QvacLlmService();

  const p2p = new P2pWorklet();
  const network = new BareWorkletNetwork(p2p);
  await network.initialize();
  const mailbox = new BareWorkletMailbox(p2p);
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
    responses,
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
