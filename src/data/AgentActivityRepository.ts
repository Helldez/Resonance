import type { IDatabase } from '@core/ports/IDatabase';

/** What the daily caps count. Mirrors the governor's cap categories. */
export type ActivityKind = 'post' | 'comment' | 'reaction';

/**
 * Deterministic state for the `ActionGovernor`: per-day action counters and a
 * bounded ledger of recent agent outputs (for textual dedup). This is the only
 * source of the governor's counts — never the LLM. Counters key on a local
 * `YYYY-MM-DD` day string supplied by the caller (from `IClock`), so a new day
 * resets the caps without any scheduled job.
 */
export class AgentActivityRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_counters (
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, kind)
      );
      CREATE TABLE IF NOT EXISTS agent_outputs (
        created_at INTEGER PRIMARY KEY,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_skipped (
        target TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Mark a candidate as terminally skipped (judged not-relevant or
   * do_nothing) so it is NOT re-evaluated by the LLM on every future tick — the
   * fix for the "keeps re-thinking the same post" loop. A new human reply in
   * the thread can clear it later if we want to reconsider; for now a skip is
   * sticky for the session's lifetime of that post.
   */
  async markSkipped(target: string, createdAt: number): Promise<void> {
    await this.db.exec(
      'INSERT OR IGNORE INTO agent_skipped (target, created_at) VALUES (?, ?)',
      [target, createdAt],
    );
  }

  async countToday(day: string, kind: ActivityKind): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      'SELECT count FROM agent_counters WHERE day = ? AND kind = ? LIMIT 1',
      [day, kind],
    );
    return rows[0]?.count ?? 0;
  }

  async incrementToday(day: string, kind: ActivityKind): Promise<void> {
    await this.db.exec(
      `INSERT INTO agent_counters (day, kind, count) VALUES (?, ?, 1)
       ON CONFLICT(day, kind) DO UPDATE SET count = count + 1`,
      [day, kind],
    );
  }

  /** Append an output to the dedup ledger, then prune to the last `keep`. */
  async recordOutput(text: string, createdAt: number, keep: number): Promise<void> {
    await this.db.exec(
      'INSERT OR REPLACE INTO agent_outputs (created_at, text) VALUES (?, ?)',
      [createdAt, text],
    );
    await this.db.exec(
      `DELETE FROM agent_outputs WHERE created_at NOT IN (
         SELECT created_at FROM agent_outputs ORDER BY created_at DESC LIMIT ?
       )`,
      [keep],
    );
  }

  async recentOutputs(limit: number): Promise<string[]> {
    const rows = await this.db.query<{ text: string }>(
      'SELECT text FROM agent_outputs ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map((r) => r.text);
  }
}
