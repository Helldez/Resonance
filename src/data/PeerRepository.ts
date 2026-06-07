import type { IDatabase } from '@core/ports/IDatabase';
import type { PeerId } from '@core/domain/types';

/**
 * Lightweight per-peer state: last-seen, optional handle the user assigned
 * locally (never broadcast), and reputation signal aggregates. In the
 * single-room model there are no sticky peers — Hyperswarm discovery plus
 * directory gossip keep everyone reachable — so no noise keys are stored.
 */
export class PeerRepository {
  constructor(private readonly db: IDatabase) {}

  async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS peers (
        peer_id TEXT PRIMARY KEY,
        local_label TEXT,
        last_seen_at INTEGER,
        helpful_count INTEGER NOT NULL DEFAULT 0,
        unhelpful_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async touch(peerId: PeerId, seenAt: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO peers (peer_id, last_seen_at) VALUES (?, ?)
       ON CONFLICT(peer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [peerId, seenAt],
    );
  }
}
