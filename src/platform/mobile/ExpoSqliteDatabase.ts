import * as SQLite from 'expo-sqlite';
import type { IDatabase } from '@core/ports/IDatabase';
import { StorageConfig } from '@core/config/StorageConfig';

/**
 * Thin wrapper over expo-sqlite. Opens the single app database lazily and
 * exposes the minimal surface declared by `IDatabase`.
 */
export class ExpoSqliteDatabase implements IDatabase {
  private db: SQLite.SQLiteDatabase | null = null;

  async initialize(): Promise<void> {
    if (this.db === null) {
      this.db = await SQLite.openDatabaseAsync(StorageConfig.databaseFile);
    }
  }

  async shutdown(): Promise<void> {
    if (this.db !== null) {
      await this.db.closeAsync();
      this.db = null;
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<T[]> {
    const db = this.must();
    const rows = await db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
    return rows;
  }

  async exec(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    const db = this.must();
    await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    const db = this.must();
    await db.withTransactionAsync(fn);
  }

  private must(): SQLite.SQLiteDatabase {
    if (this.db === null) {
      throw new Error('ExpoSqliteDatabase: not initialized');
    }
    return this.db;
  }
}
