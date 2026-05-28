import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3';
import type { IDatabase } from '@core/ports/IDatabase';

/**
 * Desktop `IDatabase` implementation backed by `better-sqlite3`. The
 * underlying API is synchronous and very fast on a local file, so each
 * port method wraps a sync call in `Promise.resolve(...)` for shape
 * compatibility with the mobile adapter.
 *
 * Schemas (`CREATE TABLE ... ; CREATE INDEX ...`) are passed as multi-
 * statement strings by the repository layer; `exec` therefore routes
 * multi-statement SQL through `db.exec()` and single-statement SQL with
 * parameters through prepared statements.
 *
 * BLOB columns: better-sqlite3 stores `Uint8Array` (or `Buffer`) values
 * verbatim and returns them as `Buffer`. Since `Buffer extends Uint8Array`,
 * the repositories that read `embedding: Uint8Array` continue to work
 * unchanged.
 */
export class NodeSqliteDatabase implements IDatabase {
  private db: BetterSqliteDatabase | null = null;
  private readonly stmtCache = new Map<string, Statement>();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    if (this.db !== null) {
      return;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const db = new Database(this.filePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    this.db = db;
  }

  async shutdown(): Promise<void> {
    if (this.db === null) {
      return;
    }
    this.stmtCache.clear();
    this.db.close();
    this.db = null;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<T[]> {
    const stmt = this.prepare(sql);
    const rows = stmt.all(...(params as unknown[])) as T[];
    return rows;
  }

  async exec(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    const db = this.must();
    if (params.length === 0 && isMultiStatement(sql)) {
      db.exec(sql);
      return;
    }
    const stmt = this.prepare(sql);
    stmt.run(...(params as unknown[]));
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    // better-sqlite3 transactions are synchronous, but the IDatabase
    // contract is async. We open the transaction manually so the caller
    // can still `await` inside `fn`. A failure inside `fn` rolls back.
    const db = this.must();
    db.exec('BEGIN');
    try {
      await fn();
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore: original error is the one we want to surface
      }
      throw err;
    }
  }

  private prepare(sql: string): Statement {
    const cached = this.stmtCache.get(sql);
    if (cached !== undefined) {
      return cached;
    }
    const stmt = this.must().prepare(sql);
    this.stmtCache.set(sql, stmt);
    return stmt;
  }

  private must(): BetterSqliteDatabase {
    if (this.db === null) {
      throw new Error('NodeSqliteDatabase: not initialized');
    }
    return this.db;
  }
}

/**
 * Multi-statement detection: better-sqlite3's `prepare()` accepts a single
 * statement only, while `exec()` runs many. Repositories use semicolons
 * to chain `CREATE TABLE; CREATE INDEX;` blocks. We treat any SQL whose
 * trimmed body contains a semicolon that is not the final character as
 * multi-statement.
 *
 * No regex per project rules — we walk the string.
 */
function isMultiStatement(sql: string): boolean {
  let seenSemi = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql.charCodeAt(i);
    const isSpace = ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d;
    if (ch === 0x3b /* ';' */) {
      seenSemi = true;
      continue;
    }
    if (isSpace) {
      continue;
    }
    if (seenSemi) {
      return true;
    }
  }
  return false;
}
