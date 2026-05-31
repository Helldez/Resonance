import type { IDatabase } from '@core/ports/IDatabase';

/** Kind of a queued action awaiting human approval (Suggest mode). */
export type PendingKind = 'post' | 'respond' | 'react';

export interface PendingAction {
  readonly id: string;
  readonly kind: PendingKind;
  /** Target record address for respond/react; null for a new post. */
  readonly target: string | null;
  readonly text: string;
  readonly reaction: string | null;
  readonly rationale: string;
  readonly createdAt: number;
}

/**
 * The "Da approvare" queue. In Suggest mode the governor routes every proposed
 * action here instead of publishing it; the Approvals screen lists these and
 * the user approves (which publishes) or dismisses (which deletes) each one.
 */
export class PendingActionRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_pending (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target TEXT,
        text TEXT NOT NULL,
        reaction TEXT,
        rationale TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_created ON agent_pending(created_at);
    `);
  }

  async add(item: PendingAction): Promise<void> {
    await this.db.exec(
      `INSERT OR REPLACE INTO agent_pending
        (id, kind, target, text, reaction, rationale, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.kind, item.target, item.text, item.reaction, item.rationale, item.createdAt],
    );
  }

  async list(): Promise<PendingAction[]> {
    const rows = await this.db.query<{
      id: string;
      kind: string;
      target: string | null;
      text: string;
      reaction: string | null;
      rationale: string;
      created_at: number;
    }>('SELECT id, kind, target, text, reaction, rationale, created_at FROM agent_pending ORDER BY created_at DESC');
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as PendingKind,
      target: r.target,
      text: r.text,
      reaction: r.reaction,
      rationale: r.rationale,
      createdAt: r.created_at,
    }));
  }

  async count(): Promise<number> {
    const rows = await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM agent_pending');
    return rows[0]?.n ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.exec('DELETE FROM agent_pending WHERE id = ?', [id]);
  }

  /** True if a queued action already targets this record (avoid duplicates). */
  async hasForTarget(target: string): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM agent_pending WHERE target = ?',
      [target],
    );
    return (rows[0]?.n ?? 0) > 0;
  }
}
