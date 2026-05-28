import { promises as fs, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IFileSystem } from '@core/ports/IFileSystem';

/**
 * Node implementation of `IFileSystem`. The app-data root is resolved at
 * construction time so the same adapter works for headless CLI peers
 * (`os.homedir()` based) and for Electron (`app.getPath('userData')`).
 *
 * The factory does not assume an OS — the caller supplies the absolute
 * root path. See `resolveDefaultAppDataDir` in `scripts/desktop/peer.mjs`
 * and `electron/main.ts` for the platform-specific defaults.
 */
export class NodeFileSystem implements IFileSystem {
  readonly appDataDir: string;

  constructor(appDataDir: string) {
    this.appDataDir = appDataDir;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async makeDir(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true });
  }

  async remove(path: string): Promise<void> {
    await fs.rm(path, { recursive: true, force: true });
  }

  async size(path: string): Promise<number> {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }

  /** Helper for callers that need to build absolute paths under appDataDir. */
  resolve(...segments: ReadonlyArray<string>): string {
    return join(this.appDataDir, ...segments);
  }
}
