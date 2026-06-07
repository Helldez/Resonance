import type { IDatabase } from '@core/ports/IDatabase';
import type { Announcement, PeerId, RecordAddress, RecordKind } from '@core/domain/types';
import { addressOf } from '@core/utils/AddressOf';
import { floatToBlob, decodeEmbedding } from './EmbeddingBlob';

/** A Tier-1 summary row decoded back into an addressable announcement + score. */
export interface AnnouncementRow {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly feedIndex: number;
  readonly kind: RecordKind;
  readonly embedding: Float32Array | null;
  readonly bestSim: number | null;
  readonly pulled: boolean;
}

/**
 * Tier-1 of the two-tier inbox memory: the durable store of lightweight
 * announcement summaries.
 *
 * Every announcement a node sees lands here (cheap: author + embedding + digest,
 * no body text). Ranking happens over this table, so the bounded `posts` inbox
 * (Tier-2, full text) holds only the ~K winners that were actually pulled.
 * Keeping Tier-1 in SQLite — not in memory — lets a re-rank after a new own
 * post reconsider announcements seen in past sessions without re-downloading
 * anything (`RerankAnnouncements`).
 *
 * Cap: `enforceCap` evicts the lowest-scoring NON-pulled rows. A pulled row is
 * never evicted here — its full post lives in `posts` under the inbox cap.
 */
export class AnnouncementRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS announcements (
        address TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        feed_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        embedding BLOB,
        digest BLOB NOT NULL,
        best_sim REAL,
        pulled INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ann_best_sim ON announcements(best_sim);
      CREATE INDEX IF NOT EXISTS idx_ann_pulled ON announcements(pulled);
    `);
  }

  /**
   * Record (or refresh) an announcement summary with its latest local score.
   * Idempotent by address. `pulled` is preserved across re-announcements via
   * the COALESCE so a re-gossip of an already-pulled post does not reset it.
   */
  async upsert(announcement: Announcement, bestSim: number | null): Promise<void> {
    const address = addressOf(announcement.author, announcement.feedIndex);
    await this.db.exec(
      `INSERT INTO announcements
         (address, author, feed_index, kind, created_at, embedding, digest, best_sim, pulled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(address) DO UPDATE SET
         best_sim = excluded.best_sim`,
      [
        address,
        announcement.author,
        announcement.feedIndex,
        announcement.kind,
        announcement.createdAt,
        announcement.embedding === null ? null : floatToBlob(announcement.embedding),
        announcement.digest,
        bestSim,
      ],
    );
  }

  /** True once the full body has been pulled and committed to the `posts` inbox. */
  async markPulled(address: RecordAddress): Promise<void> {
    await this.db.exec('UPDATE announcements SET pulled = 1 WHERE address = ?', [address]);
  }

  /**
   * Whether this announcement's body is already pulled and committed.
   * Checked before issuing a pull: re-gossips and boot rescans re-emit
   * announcements we already hold in full, and re-downloading them is pure
   * waste (observed in the 400-post stress test: 774 pulls for ~460 records).
   */
  async isPulled(address: RecordAddress): Promise<boolean> {
    const rows = await this.db.query<{ pulled: number }>(
      'SELECT pulled FROM announcements WHERE address = ?',
      [address],
    );
    return rows.length > 0 && rows[0].pulled !== 0;
  }

  /** Whether we have already seen this announcement (any state). */
  async has(address: RecordAddress): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM announcements WHERE address = ?',
      [address],
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  /**
   * Post announcements with decoded embeddings, for the re-rank pass after the
   * user's own-post set changes. Includes both pulled and not-yet-pulled rows:
   * the re-ranker re-scores everything and queues fresh winners for pull.
   */
  async listPostsForRerank(expectedDim: number): Promise<AnnouncementRow[]> {
    const rows = await this.db.query<{
      address: string;
      author: string;
      feed_index: number;
      kind: string;
      embedding: Uint8Array | null;
      best_sim: number | null;
      pulled: number;
    }>(
      `SELECT address, author, feed_index, kind, embedding, best_sim, pulled
         FROM announcements WHERE kind = 'post'`,
    );
    const out: AnnouncementRow[] = [];
    for (const row of rows) {
      out.push({
        address: row.address as RecordAddress,
        author: row.author as PeerId,
        feedIndex: row.feed_index,
        kind: row.kind as RecordKind,
        embedding: decodeEmbedding(row.embedding, expectedDim),
        bestSim: row.best_sim,
        pulled: row.pulled !== 0,
      });
    }
    return out;
  }

  /** Persist a fresh score for an already-stored announcement (re-rank pass). */
  async updateScore(address: RecordAddress, bestSim: number | null): Promise<void> {
    await this.db.exec('UPDATE announcements SET best_sim = ? WHERE address = ?', [
      bestSim,
      address,
    ]);
  }

  /** Total number of summaries held (diagnostics + cap accounting). */
  async count(): Promise<number> {
    const rows = await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM announcements');
    return rows[0]?.n ?? 0;
  }

  /**
   * Evict the lowest-scoring non-pulled summaries until the table is within
   * `capacity`. Pulled rows are exempt (their post is governed by the inbox
   * cap). Rows with a null score are evicted first — they were never rankable.
   */
  async enforceCap(capacity: number): Promise<void> {
    await this.db.exec(
      `DELETE FROM announcements WHERE address IN (
         SELECT address FROM announcements
         WHERE pulled = 0
         ORDER BY (best_sim IS NULL) DESC, best_sim ASC
         LIMIT MAX(0, (SELECT COUNT(*) FROM announcements) - ?)
       )`,
      [capacity],
    );
  }
}
