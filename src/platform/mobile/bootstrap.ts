import type { AppContainer } from '@core/bootstrap/AppContainer';
import { AsyncStorageKv } from './AsyncStorageKv';
import { BareWorkletMailbox } from './BareWorkletMailbox';
import { BareWorkletNetwork } from './BareWorkletNetwork';
import { ConsoleLogger } from './ConsoleLogger';
import { Ed25519Identity } from './Ed25519Identity';
import { ExpoFileSystem } from './ExpoFileSystem';
import { ExpoModelRegistry } from './ExpoModelRegistry';
import { ExpoSqliteDatabase } from './ExpoSqliteDatabase';
import { QvacEmbeddingService } from './QvacEmbeddingService';
import { QvacLlmService } from './QvacLlmService';
import { SystemClock } from './SystemClock';
import { bootstrapIdentity } from '@core/identity/IdentityManager';

/**
 * The single place where concrete adapters are instantiated and wired into
 * an `AppContainer`. Anything else that imports an Expo/RN/Bare module
 * outside this file is a layering violation.
 */
export async function bootstrapMobile(): Promise<AppContainer> {
  const logger = new ConsoleLogger();
  const clock = new SystemClock();
  const fileSystem = new ExpoFileSystem();
  const keyValue = new AsyncStorageKv();
  const database = new ExpoSqliteDatabase();
  await database.initialize();

  const identity = new Ed25519Identity(keyValue);
  const { self } = await bootstrapIdentity({ identity });

  // Checksum verifier is injected so the adapter doesn't import crypto.
  // TODO M1: replace stub with real SHA-256 over file contents.
  const modelRegistry = new ExpoModelRegistry(fileSystem, async () => false);

  const embedder = new QvacEmbeddingService();
  const llm = new QvacLlmService();
  const network = new BareWorkletNetwork();
  const mailbox = new BareWorkletMailbox();

  return {
    self,
    clock,
    logger,
    fileSystem,
    keyValue,
    database,
    identity,
    modelRegistry,
    embedder,
    llm,
    network,
    mailbox,
  };
}
