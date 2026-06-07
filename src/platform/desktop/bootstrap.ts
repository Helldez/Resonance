import { join } from 'node:path';
import { DesktopConfig } from './DesktopConfig';
import { StorageConfig } from '@core/config/StorageConfig';
import { ConsoleLogger } from './ConsoleLogger';
import { SubprocessTransport } from './SubprocessTransport';
import { Ed25519Identity } from './Ed25519Identity';
import { NodeFileSystem } from './NodeFileSystem';
import { NodeKvStore } from './NodeKvStore';
import { NodeSqliteDatabase } from './NodeSqliteDatabase';
import { QvacEmbeddingService } from './QvacEmbeddingService';
import { QvacLlmService } from './QvacLlmService';
import { SystemClock } from './SystemClock';
import { wireContainer } from '@platform/shared/wireContainer';
import type { LocalContainer } from '@platform/shared/wireContainer';

/** Desktop alias of the shared local container shape. */
export type DesktopContainer = LocalContainer;

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
 * Single place where the concrete desktop adapters are instantiated; the
 * shared wiring (repositories, identity, P2P worker) lives in
 * `wireContainer`. Idempotent: subsequent calls return the same instance
 * (useful when both the Electron main process and a dev REPL import it).
 */
export async function bootstrapDesktop(
  options: DesktopBootstrapOptions,
): Promise<DesktopContainer> {
  if (cached !== null) {
    return cached;
  }

  const fileSystem = new NodeFileSystem(options.appDataDir);
  await fileSystem.makeDir(options.appDataDir);
  await fileSystem.makeDir(fileSystem.resolve(StorageConfig.modelsDir));
  const corestoreDir = fileSystem.resolve(StorageConfig.corestoreDir);
  await fileSystem.makeDir(corestoreDir);

  const keyValue = new NodeKvStore(fileSystem.resolve(DesktopConfig.kvStoreFile));
  cached = await wireContainer({
    logger: new ConsoleLogger(),
    clock: new SystemClock(),
    fileSystem,
    keyValue,
    database: new NodeSqliteDatabase(fileSystem.resolve(DesktopConfig.databaseFile)),
    identity: new Ed25519Identity(keyValue),
    embedder: new QvacEmbeddingService(),
    llm: new QvacLlmService(),
    transport: new SubprocessTransport(options.bareEntryPath),
    storagePath: corestoreDir,
  });
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
