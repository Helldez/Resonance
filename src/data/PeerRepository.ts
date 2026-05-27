import type { IDatabase } from '@core/ports/IDatabase';
import type { PeerId } from '@core/domain/types';

/**
 * Lightweight per-peer state: last-seen, optional handle the user assigned
 * locally (never broadcast), and reputation signal aggregates.
 *
 * `noise_pubkey` is the peer's Hyperswarm noise public key (hex). Once we
 * have learned a peer's noise key (through a swarm topic connection), we
 * call `swarm.joinPeer(noiseKey)` on every subsequent boot to keep a
 * direct DHT connection alive regardless of which bucket either device is
 * currently in. See docs/SEMANTIC_ROUTING.md §10 — sticky peers.
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
        unhelpful_count INTEGER NOT NULL DEFAULT 0,
        noise_pubkey TEXT
      );
    `);
    // For databases that were created before `noise_pubkey` existed: add
    // the column lazily. SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT
    // EXISTS`, so we catch the "duplicate column" error and move on.
    try {
      await this.db.exec('ALTER TABLE peers ADD COLUMN noise_pubkey TEXT');
    } catch {
      // already exists — ignore
    }
  }

  async touch(peerId: PeerId, seenAt: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO peers (peer_id, last_seen_at) VALUES (?, ?)
       ON CONFLICT(peer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [peerId, seenAt],
    );
  }

  /**
   * Record (or refresh) the Hyperswarm noise key of a peer we have just
   * connected to. The `peerId` here is the peer's outbox Hypercore key —
   * the same hex we use everywhere else as a stable peer identity (it is
   * what arrives over the directory channel; the Ed25519 author key is a
   * separate identity carried in the signed records).
   */
  async setNoiseKey(peerId: string, noiseKey: string): Promise<void> {
    await this.db.exec(
      `INSERT INTO peers (peer_id, noise_pubkey) VALUES (?, ?)
       ON CONFLICT(peer_id) DO UPDATE SET noise_pubkey = excluded.noise_pubkey`,
      [peerId, noiseKey],
    );
  }

  /**
   * All known peer noise keys, ready to be passed to
   * `IPeerNetwork.joinPeer` at boot. Peers we have never connected to
   * (just received via signed records replicated through somebody else)
   * are excluded — without a noise key there is nothing to dial.
   */
  async listNoiseKeys(): Promise<string[]> {
    const rows = await this.db.query<{ noise_pubkey: string | null }>(
      'SELECT noise_pubkey FROM peers WHERE noise_pubkey IS NOT NULL',
    );
    const out: string[] = [];
    for (const r of rows) {
      if (typeof r.noise_pubkey === 'string' && r.noise_pubkey.length > 0) {
        out.push(r.noise_pubkey);
      }
    }
    return out;
  }
}
