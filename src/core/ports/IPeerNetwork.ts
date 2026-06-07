import type { Announcement, PeerId, SignedRecord } from '@core/domain/types';

export interface IPeerNetworkEvents {
  /**
   * A new lightweight announcement was gossiped by a peer. The receiver ranks
   * it locally and, if it earns an inbox slot, calls `requestPull`. This is the
   * high-volume event (every peer sees every announcement).
   */
  onAnnouncement(handler: (announcement: Announcement) => void): () => void;
  /**
   * A full record arrived — either one we pulled after admitting its
   * announcement, or our own echoed back. Fires only for the bounded set we
   * actually fetch, not for every post in the room.
   */
  onRecord(handler: (record: SignedRecord) => void): () => void;
  /** A peer connection came up or went down. */
  onPeerPresence(handler: (peer: PeerId, present: boolean) => void): () => void;
}

export interface IPeerNetwork extends IPeerNetworkEvents {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  /**
   * Join the single shared room (conf-9 "Keet model"). The room id and topic
   * namespace come from `RoomConfig`; this is the only swarm topic a node
   * ever joins. Idempotent — safe to call once at boot.
   */
  joinRoom(): Promise<void>;

  /** Publish a signed record into our own append-only feed. */
  publish(record: SignedRecord): Promise<void>;

  /**
   * Fetch the full body of a single admitted record by address. Opens the
   * author's outbox core in sparse mode and downloads exactly its one block;
   * the result is delivered through `onRecord` once verified. Best-effort:
   * a pull that cannot find a holder within `RoomConfig.pullTimeoutMs` is
   * abandoned and may be retried by a later re-rank.
   */
  requestPull(author: PeerId, feedIndex: number): Promise<void>;

  /**
   * Replay every post already replicated into the local cores, re-delivering
   * each through `onRecord`. Used after publishing a post to re-evaluate the
   * full history against the new own-post signal — surfacing related posts
   * that were dropped at admission while the inbox had no (or a different) set
   * of own posts to score against. Idempotent on the receiver side.
   */
  rescan(): Promise<void>;
}
