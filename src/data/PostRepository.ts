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
        similarity REAL,
        matched_own_address TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
      CREATE INDEX IF NOT EXISTS idx_posts_similarity ON posts(similarity);
    `);

    // Migration: `matched_own_address` records which OWN post a remote post
    // scored its MAX cosine against, so the inbox can group each remote post
    // under the user's most-affine post. Added after the initial single-room
    // schema, so an existing table needs the column appended in place.
    const after = await this.db.query<{ name: string }>(
      'PRAGMA table_info(posts)',
    );
    if (!after.some((c) => c.name === 'matched_own_address')) {
      await this.db.exec(
        'ALTER TABLE posts ADD COLUMN matched_own_address TEXT',
      );
    }
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
    matchedOwnAddress: RecordAddress | null = null,
  ): Promise<void> {
    await this.db.exec(
      `INSERT OR REPLACE INTO posts
        (address, author, feed_index, text, embedding, created_at, similarity, matched_own_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        address,
        author,
        feedIndex,
        post.text,
        floatToBlob(post.embedding),
        post.createdAt,
        similarity,
        matchedOwnAddress,
      ],
    );
  }

  /**
   * Update the score of an already-stored remote post. Used by the inbox
   * re-scoring pass that runs after the user publishes a post: every remote
   * post is re-compared against the (now larger) set of own posts so its
   * `similarity` and `matched_own_address` stay consistent with the current
   * posting history. Touches only the score columns — embedding/text/etc.
   * are left untouched.
   */
  async updateScore(
    address: RecordAddress,
    similarity: number | null,
    matchedOwnAddress: RecordAddress | null,
  ): Promise<void> {
    await this.db.exec(
      'UPDATE posts SET similarity = ?, matched_own_address = ? WHERE address = ?',
      [similarity, matchedOwnAddress, address],
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
   * Like `getOwnEmbeddings`, but each embedding carries the address of the
   * post it came from. The receiver-side scorer needs the address so it can
   * record WHICH own post a remote post matched against (`matched_own_address`),
   * which drives the grouped inbox view.
   */
  async getOwnEmbeddingsWithAddress(
    self: PeerId,
    expectedDim: number,
  ): Promise<Array<{ address: RecordAddress; embedding: Float32Array }>> {
    const rows = await this.db.query<{ address: string; embedding: Uint8Array }>(
      'SELECT address, embedding FROM posts WHERE author = ?',
      [self],
    );
    const out: Array<{ address: RecordAddress; embedding: Float32Array }> = [];
    for (const row of rows) {
      const embedding = decodeEmbedding(row.embedding, expectedDim);
      if (embedding === null) {
        continue;
      }
      out.push({ address: row.address as RecordAddress, embedding });
    }
    return out;
  }

  /**
   * Remote (non-self) posts with their embeddings decoded. Used by the inbox
   * re-scoring pass to recompute each post's similarity against the user's
   * own posts after a new post is published.
   */
  async getRemoteEmbeddings(
    self: PeerId,
    expectedDim: number,
  ): Promise<Array<{ address: RecordAddress; embedding: Float32Array }>> {
    const rows = await this.db.query<{ address: string; embedding: Uint8Array }>(
      'SELECT address, embedding FROM posts WHERE author != ?',
      [self],
    );
    const out: Array<{ address: RecordAddress; embedding: Float32Array }> = [];
    for (const row of rows) {
      const embedding = decodeEmbedding(row.embedding, expectedDim);
      if (embedding === null) {
        continue;
      }
      out.push({ address: row.address as RecordAddress, embedding });
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
    opts: {
      includeSelf?: boolean;
      excludeAddress?: RecordAddress;
      minSimilarity?: number;
    } = {},
  ): Promise<MapPostRow[]> {
    // The per-post map plots peers only (`author != self`). The global "my
    // posts" map (`includeSelf`) plots everyone, omitting just the anchor so
    // it is not duplicated.
    //
    // When `minSimilarity` is set the map honours the same view filter as the
    // Inbox: drop posts below the threshold, but always keep own posts (stored
    // with a null similarity) so the user's personal history never disappears
    // from the "my posts" map.
    const hasMin = typeof opts.minSimilarity === 'number';
    const simPredicate = hasMin ? ' AND (similarity IS NULL OR similarity >= ?)' : '';
    const lead = opts.includeSelf ? (opts.excludeAddress ?? '') : self;
    const leadColumn = opts.includeSelf ? 'address' : 'author';
    const params: ReadonlyArray<unknown> = hasMin
      ? [lead, opts.minSimilarity, limit]
      : [lead, limit];
    const sql = `SELECT address, author, text, embedding, created_at, similarity
                FROM posts
                WHERE ${leadColumn} != ?${simPredicate}
                ORDER BY created_at DESC
                LIMIT ?`;
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
