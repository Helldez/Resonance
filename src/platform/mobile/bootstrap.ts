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
import { AsyncStorageKv } from './AsyncStorageKv';
import { ConsoleLogger } from './ConsoleLogger';
import { Ed25519Identity } from './Ed25519Identity';
import { ExpoFileSystem } from './ExpoFileSystem';
import { ExpoSqliteDatabase } from './ExpoSqliteDatabase';
import { WorkletTransport } from './WorkletTransport';
import { QvacEmbeddingService } from './QvacEmbeddingService';
import { QvacLlmService } from './QvacLlmService';
import { SystemClock } from './SystemClock';
import { StorageConfig } from '@core/config/StorageConfig';
import { wireContainer } from '@platform/shared/wireContainer';
import type { LocalContainer } from '@platform/shared/wireContainer';

/** Mobile alias of the shared local container shape. */
export type MobileContainer = LocalContainer;

let cached: MobileContainer | null = null;

/**
 * Single place where the mobile concrete adapters are instantiated; the
 * shared wiring (repositories, identity, P2P worker) lives in
 * `wireContainer`. Idempotent.
 */
export async function bootstrapMobile(): Promise<MobileContainer> {
  if (cached !== null) {
    return cached;
  }

  // Corestore lives under the app's document directory; Bare wants a plain
  // filesystem path, so strip the file:// scheme expo-file-system reports.
  const docUri = Paths.document.uri;
  const docPath = docUri.startsWith('file://') ? docUri.slice('file://'.length) : docUri;
  const storagePath = `${docPath}${StorageConfig.corestoreDir}`;

  const keyValue = new AsyncStorageKv();
  cached = await wireContainer({
    logger: new ConsoleLogger(),
    clock: new SystemClock(),
    fileSystem: new ExpoFileSystem(),
    keyValue,
    database: new ExpoSqliteDatabase(),
    identity: new Ed25519Identity(keyValue),
    embedder: new QvacEmbeddingService(),
    llm: new QvacLlmService(),
    transport: new WorkletTransport(),
    storagePath,
  });
  return cached;
}

export function getContainer(): MobileContainer {
  if (cached === null) {
    throw new Error('bootstrapMobile has not finished yet');
  }
  return cached;
}
