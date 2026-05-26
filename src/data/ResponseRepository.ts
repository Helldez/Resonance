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
