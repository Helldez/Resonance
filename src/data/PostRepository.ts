import type { IDatabase } from '@core/ports/IDatabase';
import type { PeerId, PostBody, RecordAddress } from '@core/domain/types';

/**
 * Posts are durably stored in SQLite for fast inbox/thread queries.
 * The authoritative record stays in the Hypercore feed (mailbox); this
 * table is a projection optimised for read paths.
 */
export class PostRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        address TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        feed_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        bucket TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        similarity REAL
      );
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
      CREATE INDEX IF NOT EXISTS idx_posts_bucket ON posts(bucket);
    `);
  }

  async upsert(
    address: RecordAddress,
    author: PeerId,
    feedIndex: number,
    post: PostBody,
    similarity: number | null,
  ): Promise<void> {
    await this.db.exec(
      `INSERT OR REPLACE INTO posts
        (address, author, feed_index, text, embedding, bucket, created_at, similarity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        address,
        author,
        feedIndex,
        post.text,
        floatToBlob(post.embedding),
        post.bucket,
        post.createdAt,
        similarity,
      ],
    );
  }

  // Read paths intentionally minimal for the MVP — added as screens land.
}

function floatToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
