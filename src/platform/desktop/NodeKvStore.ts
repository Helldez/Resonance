import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { IKeyValueStore } from '@core/ports/IKeyValueStore';

/**
 * Simple JSON-on-disk key/value store. Writes are atomic via temp-file +
 * rename so a crash mid-write cannot truncate the store. The whole map is
 * held in memory; this is fine for the few dozen keys the app stores
 * (identity seed, settings, sticky peers) and avoids pulling in a second
 * SQLite connection.
 *
 * NOT encrypted at rest. The desktop equivalent of the Phase 2 mobile
 * migration to secure storage will use OS keychains (e.g. `keytar` on
 * Electron). Tracked alongside the same Phase 2 work as mobile.
 */
export class NodeKvStore implements IKeyValueStore {
  private cache: Record<string, string> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(key: string): Promise<string | null> {
    const map = await this.load();
    const v = map[key];
    return v === undefined ? null : v;
  }

  async set(key: string, value: string): Promise<void> {
    const map = await this.load();
    map[key] = value;
    await this.persist(map);
  }

  async delete(key: string): Promise<void> {
    const map = await this.load();
    if (!(key in map)) {
      return;
    }
    delete map[key];
    await this.persist(map);
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache !== null) {
      return this.cache;
    }
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      this.cache = isStringRecord(parsed) ? parsed : {};
    } catch (err) {
      if (isNotFoundError(err)) {
        this.cache = {};
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private persist(map: Record<string, string>): Promise<void> {
    const next = this.writeQueue.then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(map), 'utf8');
      await fs.rename(tmp, this.filePath);
    });
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      return false;
    }
  }
  return true;
}

function isNotFoundError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
