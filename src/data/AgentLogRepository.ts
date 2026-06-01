import type { IDatabase } from '@core/ports/IDatabase';

/**
 * One persisted line of agent activity, shown in the in-app Activity dashboard.
 * `phase` is the step in the loop; `verdict`/`detail` carry the human-readable
 * explanation so the user can see WHAT the agent did and WHY, in real time.
 */
export type AgentLogPhase =
  | 'tick'        // a wake-up: how many candidates, autonomy
  | 'triage'      // relevance judgement on a candidate
  | 'decide'      // chosen action (respond/react/do_nothing)
  | 'govern'      // governor verdict (allow/queue/reject + reason)
  | 'publish'     // an action actually published to the room
  | 'queue'       // an action queued for approval (suggest mode)
  | 'post'        // a proactive post attempt
  | 'error';      // a tick-level failure

export interface AgentLogEntry {
  readonly id: number;
  readonly createdAt: number;
  readonly phase: AgentLogPhase;
  /** Target record address (post/response) this entry refers to, if any. */
  readonly target: string | null;
  /** Short headline, e.g. "respond → queue" or "triage 0.70 ≥ 0.55". */
  readonly summary: string;
  /** The actual text the agent wrote/considered, if any. */
  readonly text: string | null;
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
        text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_log_created ON agent_log(created_at);
    `);
  }

  async append(
    createdAt: number,
    phase: AgentLogPhase,
    summary: string,
    target: string | null = null,
    text: string | null = null,
  ): Promise<void> {
    await this.db.exec(
      'INSERT INTO agent_log (created_at, phase, target, summary, text) VALUES (?, ?, ?, ?, ?)',
      [createdAt, phase, target, summary, text],
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
    }>(
      'SELECT id, created_at, phase, target, summary, text FROM agent_log ORDER BY id DESC LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      phase: r.phase as AgentLogPhase,
      target: r.target,
      summary: r.summary,
      text: r.text,
    }));
  }

  async clear(): Promise<void> {
    await this.db.exec('DELETE FROM agent_log');
  }
}
