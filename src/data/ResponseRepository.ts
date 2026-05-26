import type { IDatabase } from '@core/ports/IDatabase';
import type {
  PeerId,
  RecordAddress,
  ResponseBody,
} from '@core/domain/types';

export class ResponseRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS responses (
        address TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        feed_index INTEGER NOT NULL,
        in_reply_to TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_responses_reply ON responses(in_reply_to);
    `);
  }

  /**
   * Remove a response from the local DB. Local-only delete; the remote
   * peer's outbox still holds the block.
   */
  async delete(address: RecordAddress): Promise<void> {
    await this.db.exec('DELETE FROM responses WHERE address = ?', [address]);
  }

  /**
   * How many responses by `author` are currently stored under `inReplyTo`.
   * Used to enforce the one-response-per-peer-per-post rule.
   */
  async countByAuthorAndPost(author: PeerId, inReplyTo: RecordAddress): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM responses WHERE author = ? AND in_reply_to = ?',
      [author, inReplyTo],
    );
    return rows[0]?.n ?? 0;
  }

  async upsert(
    address: RecordAddress,
    author: PeerId,
    feedIndex: number,
    body: ResponseBody,
  ): Promise<void> {
    await this.db.exec(
      `INSERT OR REPLACE INTO responses
        (address, author, feed_index, in_reply_to, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        address,
        author,
        feedIndex,
        body.inReplyTo,
        body.text,
        body.createdAt,
      ],
    );
  }
}
