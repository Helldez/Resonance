import type { IDatabase } from '@core/ports/IDatabase';
import type { AgentLogPhase } from '@core/agent/ActivityTypes';

export type { AgentLogPhase } from '@core/agent/ActivityTypes';

/**
 * One persisted line of agent activity, shown in the in-app Activity dashboard.
 * `phase` is the step in the loop; `summary`/`text` carry the human-readable
 * explanation so the user can see WHAT the agent did and WHY, in real time.
 */
export interface AgentLogEntry {
  readonly id: number;
  readonly createdAt: number;
  readonly phase: AgentLogPhase;
  /** Target record address (post/response) this entry refers to, if any. */
  readonly target: string | null;
  /** Short headline, e.g. "respond → queue" or "triage 0.70 ≥ 0.55". */
  readonly summary: string;
  /** The text the agent itself wrote (its reply/post), if any. */
  readonly text: string | null;
  /** The post/comment the agent is reacting to (the reference), if any. */
  readonly refText: string | null;
}

const KEEP = 500;

/**
 * Bounded, append-only log of agent activity persisted to SQLite so the
 * Activity dashboard survives app restarts and can be read in real time. Old
 * entries are pruned to the last `KEEP` so the table never grows unbounded.
 */
export class AgentLogRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        phase TEXT NOT NULL,
        target TEXT,
        summary TEXT NOT NULL,
        text TEXT,
        ref_text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_log_created ON agent_log(created_at);
    `);
    // Migration: ref_text (the post/comment being replied to) was added after
    // the initial agent_log schema; append it in place on existing tables.
    const cols = await this.db.query<{ name: string }>('PRAGMA table_info(agent_log)');
    if (!cols.some((c) => c.name === 'ref_text')) {
      await this.db.exec('ALTER TABLE agent_log ADD COLUMN ref_text TEXT');
    }
  }

  async append(
    createdAt: number,
    phase: AgentLogPhase,
    summary: string,
    target: string | null = null,
    text: string | null = null,
    refText: string | null = null,
  ): Promise<void> {
    await this.db.exec(
      'INSERT INTO agent_log (created_at, phase, target, summary, text, ref_text) VALUES (?, ?, ?, ?, ?, ?)',
      [createdAt, phase, target, summary, text, refText],
    );
    await this.db.exec(
      `DELETE FROM agent_log WHERE id NOT IN (
         SELECT id FROM agent_log ORDER BY id DESC LIMIT ?
       )`,
      [KEEP],
    );
  }

  async recent(limit: number): Promise<AgentLogEntry[]> {
    const rows = await this.db.query<{
      id: number;
      created_at: number;
      phase: string;
      target: string | null;
      summary: string;
      text: string | null;
      ref_text: string | null;
    }>(
      'SELECT id, created_at, phase, target, summary, text, ref_text FROM agent_log ORDER BY id DESC LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      phase: r.phase as AgentLogPhase,
      target: r.target,
      summary: r.summary,
      text: r.text,
      refText: r.ref_text,
    }));
  }

  async clear(): Promise<void> {
    await this.db.exec('DELETE FROM agent_log');
  }
}
