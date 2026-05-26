/** Thin SQL execution surface. Backed by expo-sqlite in mobile. */
export interface IDatabase {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  /** Execute a statement that returns rows. */
  query<T = Record<string, unknown>>(sql: string, params?: ReadonlyArray<unknown>): Promise<T[]>;

  /** Execute a statement that does not return rows. */
  exec(sql: string, params?: ReadonlyArray<unknown>): Promise<void>;

  /** Run multiple statements atomically. */
  transaction(fn: () => Promise<void>): Promise<void>;
}
