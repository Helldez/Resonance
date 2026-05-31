import type { IDatabase } from '@core/ports/IDatabase';
import type { PeerId, PostBody, RecordAddress } from '@core/domain/types';

export interface MapPostRow {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly embedding: Float32Array;
  readonly createdAt: number;
  readonly similarity: number | null;
}

/**
 * Posts are durably stored in SQLite for fast inbox/thread queries.
 * The authoritative record stays in the Hypercore feed (mailbox); this
 * table is a projection optimised for read paths.
 */
export class PostRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    // Legacy migration: the pre-single-room schema had a `bucket TEXT NOT
    // NULL` column. Inserts now omit `bucket`, which would violate that
    // constraint on an existing DB, so drop the old table. The single-room
    // switch is a v3 network reset (and an embedding-dim change), so stored
    // posts are discarded anyway — see `dropIfDimChanged`.
    const cols = await this.db.query<{ name: string }>(
      'PRAGMA table_info(posts)',
    );
    if (cols.some((c) => c.name === 'bucket')) {
      await this.db.exec('DROP TABLE IF EXISTS posts');
    }
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        address TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        feed_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        similarity REAL
      );
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
      CREATE INDEX IF NOT EXISTS idx_posts_similarity ON posts(similarity);
    `);
  }

  /**
   * Drop every stored post if any existing embedding blob has a byte length
   * incompatible with `currentDim`. Used to handle an embedding-model swap
   * (e.g. EmbeddingGemma 256-dim → bge-m3 1024-dim): the old vectors live
   * in a different semantic space and would silently degrade matching.
   *
   * Returns the number of rows removed. A no-op when the dim matches or the
   * table is empty.
   */
  async dropIfDimChanged(currentDim: number): Promise<number> {
    const probe = await this.db.query<{ embedding: Uint8Array }>(
      'SELECT embedding FROM posts LIMIT 1',
    );
    if (probe.length === 0) {
      return 0;
    }
    const expectedBytes = currentDim * Float32Array.BYTES_PER_ELEMENT;
    const actualBytes = probe[0].embedding?.byteLength ?? -1;
    if (actualBytes === expectedBytes) {
      return 0;
    }
    const countRows = await this.db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM posts',
    );
    const removed = countRows[0]?.n ?? 0;
    await this.db.exec('DELETE FROM posts');
    return removed;
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
        (address, author, feed_index, text, embedding, created_at, similarity)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        address,
        author,
        feedIndex,
        post.text,
        floatToBlob(post.embedding),
        post.createdAt,
        similarity,
      ],
    );
  }

  /**
   * Remove a post from the local DB. Does not propagate to peers — their
   * outbox Hypercore still has the block. Use to hide a post from your
   * own inbox.
   */
  async delete(address: RecordAddress): Promise<void> {
    await this.db.exec('DELETE FROM posts WHERE address = ?', [address]);
  }

  /**
   * Number of remote (non-self) posts currently held — the size of the
   * bounded inbox, used by the conf-9 admission rule. Own posts do not
   * count against the inbox budget.
   */
  async countRemotePosts(self: PeerId): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM posts WHERE author != ?',
      [self],
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * The weakest remote post in the inbox (lowest scored similarity), or
   * `null` when there is none. The candidate for eviction when the inbox
   * is full and a higher-scoring post arrives. Rows with a null similarity
   * are ignored — they were admitted without a comparable score.
   */
  async minSimilarityRemotePost(
    self: PeerId,
  ): Promise<{ address: RecordAddress; similarity: number } | null> {
    const rows = await this.db.query<{ address: string; similarity: number }>(
      `SELECT address, similarity FROM posts
       WHERE author != ? AND similarity IS NOT NULL
       ORDER BY similarity ASC
       LIMIT 1`,
      [self],
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      address: rows[0].address as RecordAddress,
      similarity: rows[0].similarity,
    };
  }

  /**
   * Returns the embeddings of posts authored by `self`, used to score
   * incoming remote posts against the user's actual posting history.
   * The expected dimension comes from `MatchingConfig.embeddingDim` and
   * is the contract every embedding in the DB must respect.
   */
  async getOwnEmbeddings(self: PeerId, expectedDim: number): Promise<Float32Array[]> {
    const rows = await this.db.query<{ embedding: Uint8Array }>(
      'SELECT embedding FROM posts WHERE author = ?',
      [self],
    );
    const expectedBytes = expectedDim * Float32Array.BYTES_PER_ELEMENT;
    const out: Float32Array[] = [];
    for (const row of rows) {
      const blob = row.embedding;
      if (blob === null || blob === undefined) {
        continue;
      }
      if (blob.byteLength !== expectedBytes) {
        continue;
      }
      out.push(new Float32Array(blob.buffer, blob.byteOffset, expectedDim));
    }
    return out;
  }

  /**
   * One post with its embedding decoded. Used by the semantic map to fetch
   * the anchor (the user's just-published post) before projection.
   */
  async getOneWithEmbedding(
    address: RecordAddress,
    expectedDim: number,
  ): Promise<MapPostRow | null> {
    const rows = await this.db.query<{
      address: string;
      author: string;
      text: string;
      embedding: Uint8Array;
      created_at: number;
      similarity: number | null;
    }>(
      `SELECT address, author, text, embedding, created_at, similarity
       FROM posts WHERE address = ? LIMIT 1`,
      [address],
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    const embedding = decodeEmbedding(row.embedding, expectedDim);
    if (embedding === null) {
      return null;
    }
    return {
      address: row.address as RecordAddress,
      author: row.author as PeerId,
      text: row.text,
      embedding,
      createdAt: row.created_at,
      similarity: row.similarity,
    };
  }

  /**
   * Posts from peers other than `self`, most recent first, capped at
   * `limit`. Used by the semantic map to populate the candidate set
   * around the anchor. Embeddings are decoded into Float32Array; rows
   * whose stored blob does not match `expectedDim` are skipped silently
   * (they would break cosine math downstream).
   */
  async listForMap(
    self: PeerId,
    limit: number,
    expectedDim: number,
    opts: { includeSelf?: boolean; excludeAddress?: RecordAddress } = {},
  ): Promise<MapPostRow[]> {
    // The per-post map plots peers only (`author != self`). The global "my
    // posts" map (`includeSelf`) plots everyone, omitting just the anchor so
    // it is not duplicated.
    const { sql, params } = opts.includeSelf
      ? {
          sql: `SELECT address, author, text, embedding, created_at, similarity
                FROM posts
                WHERE address != ?
                ORDER BY created_at DESC
                LIMIT ?`,
          params: [opts.excludeAddress ?? '', limit] as ReadonlyArray<unknown>,
        }
      : {
          sql: `SELECT address, author, text, embedding, created_at, similarity
                FROM posts
                WHERE author != ?
                ORDER BY created_at DESC
                LIMIT ?`,
          params: [self, limit] as ReadonlyArray<unknown>,
        };
    const rows = await this.db.query<{
      address: string;
      author: string;
      text: string;
      embedding: Uint8Array;
      created_at: number;
      similarity: number | null;
    }>(sql, params);
    const out: MapPostRow[] = [];
    for (const row of rows) {
      const embedding = decodeEmbedding(row.embedding, expectedDim);
      if (embedding === null) {
        continue;
      }
      out.push({
        address: row.address as RecordAddress,
        author: row.author as PeerId,
        text: row.text,
        embedding,
        createdAt: row.created_at,
        similarity: row.similarity,
      });
    }
    return out;
  }
}

function decodeEmbedding(blob: Uint8Array | null | undefined, expectedDim: number): Float32Array | null {
  if (blob === null || blob === undefined) {
    return null;
  }
  const expectedBytes = expectedDim * Float32Array.BYTES_PER_ELEMENT;
  if (blob.byteLength !== expectedBytes) {
    return null;
  }
  return new Float32Array(blob.buffer, blob.byteOffset, expectedDim);
}

function floatToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
