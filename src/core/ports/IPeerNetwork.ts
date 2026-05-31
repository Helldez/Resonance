import type { PeerId, SignedRecord } from '@core/domain/types';

export interface IPeerNetworkEvents {
  /** A new signed record was received from a peer in the shared room. */
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
   * Replay every post already replicated into the local cores, re-delivering
   * each through `onRecord`. Used after publishing a post to re-evaluate the
   * full history against the new own-post signal — surfacing related posts
   * that were dropped at admission while the inbox had no (or a different) set
   * of own posts to score against. Idempotent on the receiver side.
   */
  rescan(): Promise<void>;
}
