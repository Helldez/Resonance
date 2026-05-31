import { DatabaseSync } from 'node:sqlite';
import type { IDatabase } from '@core/ports/IDatabase';

/** Values SQLite can bind/return through the built-in driver. */
type SqliteValue = null | number | bigint | string | Uint8Array;

/**
 * Desktop `IDatabase` over the runtime's **built-in** SQLite (`node:sqlite`,
 * `DatabaseSync`). Synchronous and file-backed, mirroring the mobile
 * `ExpoSqliteDatabase` surface: parameterised `query`/`exec` plus a coarse
 * `transaction` wrapper.
 *
 * We deliberately use the runtime-provided SQLite instead of a native addon
 * (e.g. better-sqlite3): a compiled `.node` is pinned to one Node ABI and
 * breaks on every Node upgrade, which is exactly the off-stack coupling this
 * project avoids. `node:sqlite` ships with the runtime — no build step, no ABI
 * mismatch, no patches. The same role is played by `bare-sqlite` if/when the
 * desktop host is moved onto the Bare runtime.
 */
export class NodeSqliteDatabase implements IDatabase {
  private db: DatabaseSync | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  async shutdown(): Promise<void> {
    if (this.db !== null) {
      this.db.close();
      this.db = null;
    }
  }

  query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<T[]> {
    const db = this.require();
    const stmt = db.prepare(sql);
    const rows = stmt.all(...(params as ReadonlyArray<SqliteValue>)) as T[];
    return Promise.resolve(rows);
  }

  exec(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    const db = this.require();
    if (params.length > 0) {
      db.prepare(sql).run(...(params as ReadonlyArray<SqliteValue>));
    } else {
      // exec() runs every statement in the string — needed for multi-statement
      // schema/DDL blocks the repositories pass in.
      db.exec(sql);
    }
    return Promise.resolve();
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    // The repositories only batch DDL/seed writes through here; a serialised
    // await is enough for the desktop peer. The built-in driver's atomic
    // transaction helper requires a synchronous function, which our async
    // repositories are not, so we approximate with sequential execution.
    await fn();
  }

  private require(): DatabaseSync {
    if (this.db === null) {
      throw new Error('NodeSqliteDatabase not initialised');
    }
    return this.db;
  }
}
