import type { IDatabase } from '@core/ports/IDatabase';
import type {
  PeerId,
  ReactionBody,
  ReactionType,
  RecordAddress,
} from '@core/domain/types';

/** Aggregated count of a single reaction type under one target. */
export interface ReactionCount {
  readonly target: RecordAddress;
  readonly reaction: ReactionType;
  readonly count: number;
}

/** The reaction a given author currently holds on a target. */
export interface MyReaction {
  readonly target: RecordAddress;
  readonly reaction: ReactionType;
}

/**
 * Local projection of signed `reaction` records. A reaction targets a post or
 * a response (`in_reply_to`). The product rule is **one reaction per
 * (author, target)**: a newer reaction from the same author replaces the older
 * one, so a peer can change (or, locally, clear) their reaction. The
 * authoritative records still live in each peer's Hypercore feed; this table is
 * a read-optimised view for the feed and thread screens.
 */
export class ReactionRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reactions (
        address TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        feed_index INTEGER NOT NULL,
        in_reply_to TEXT NOT NULL,
        reaction TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(in_reply_to);
      CREATE INDEX IF NOT EXISTS idx_reactions_author_target
        ON reactions(author, in_reply_to);
    `);
  }

  /**
   * Apply an incoming (or own) reaction record, keeping a single latest
   * reaction per (author, target). An older record arriving after a newer one
   * (out-of-order replication) is ignored. Re-delivery of the same record is a
   * no-op replace.
   */
  async applyFromRecord(
    address: RecordAddress,
    author: PeerId,
    feedIndex: number,
    body: ReactionBody,
  ): Promise<void> {
    const existing = await this.db.query<{ created_at: number }>(
      'SELECT created_at FROM reactions WHERE author = ? AND in_reply_to = ? ORDER BY created_at DESC LIMIT 1',
      [author, body.inReplyTo],
    );
    if (existing.length > 0 && existing[0].created_at > body.createdAt) {
      return;
    }
    await this.db.exec(
      'DELETE FROM reactions WHERE author = ? AND in_reply_to = ?',
      [author, body.inReplyTo],
    );
    await this.db.exec(
      `INSERT OR REPLACE INTO reactions
        (address, author, feed_index, in_reply_to, reaction, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [address, author, feedIndex, body.inReplyTo, body.reaction, body.createdAt],
    );
  }

  /** Local-only delete of a reaction by its record address. */
  async delete(address: RecordAddress): Promise<void> {
    await this.db.exec('DELETE FROM reactions WHERE address = ?', [address]);
  }

  /** Local-only clear of an author's reaction on a target (used for un-react). */
  async clear(author: PeerId, target: RecordAddress): Promise<void> {
    await this.db.exec(
      'DELETE FROM reactions WHERE author = ? AND in_reply_to = ?',
      [author, target],
    );
  }

  /** Per-type counts for a single target (thread screen). */
  async countsForTarget(target: RecordAddress): Promise<ReactionCount[]> {
    const rows = await this.db.query<{ reaction: string; n: number }>(
      'SELECT reaction, COUNT(*) AS n FROM reactions WHERE in_reply_to = ? GROUP BY reaction',
      [target],
    );
    return rows.map((r) => ({
      target,
      reaction: r.reaction as ReactionType,
      count: r.n,
    }));
  }

  /** This author's current reaction on a target, or null. */
  async myReactionForTarget(
    author: PeerId,
    target: RecordAddress,
  ): Promise<ReactionType | null> {
    const rows = await this.db.query<{ reaction: string }>(
      'SELECT reaction FROM reactions WHERE author = ? AND in_reply_to = ? LIMIT 1',
      [author, target],
    );
    return rows.length === 0 ? null : (rows[0].reaction as ReactionType);
  }

  /**
   * Batch per-type counts for many targets at once — the feed loads counts for
   * every visible card in one query to avoid an N+1 pattern.
   */
  async countsForTargets(targets: ReadonlyArray<RecordAddress>): Promise<ReactionCount[]> {
    if (targets.length === 0) {
      return [];
    }
    const placeholders = buildPlaceholders(targets.length);
    const rows = await this.db.query<{
      in_reply_to: string;
      reaction: string;
      n: number;
    }>(
      `SELECT in_reply_to, reaction, COUNT(*) AS n FROM reactions
       WHERE in_reply_to IN (${placeholders})
       GROUP BY in_reply_to, reaction`,
      targets as ReadonlyArray<unknown>,
    );
    return rows.map((r) => ({
      target: r.in_reply_to as RecordAddress,
      reaction: r.reaction as ReactionType,
      count: r.n,
    }));
  }

  /** Batch lookup of one author's reactions across many targets. */
  async myReactionsForTargets(
    author: PeerId,
    targets: ReadonlyArray<RecordAddress>,
  ): Promise<MyReaction[]> {
    if (targets.length === 0) {
      return [];
    }
    const placeholders = buildPlaceholders(targets.length);
    const rows = await this.db.query<{ in_reply_to: string; reaction: string }>(
      `SELECT in_reply_to, reaction FROM reactions
       WHERE author = ? AND in_reply_to IN (${placeholders})`,
      [author, ...targets] as ReadonlyArray<unknown>,
    );
    return rows.map((r) => ({
      target: r.in_reply_to as RecordAddress,
      reaction: r.reaction as ReactionType,
    }));
  }
}

/** Build `?, ?, ...` for an IN clause with `count` parameters. */
function buildPlaceholders(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    out += i === 0 ? '?' : ', ?';
  }
  return out;
}
