import type { BucketId, PeerId, SignedRecord } from '@core/domain/types';

export interface IPeerNetworkEvents {
  /** A new signed record was received from a peer in a joined bucket. */
  onRecord(handler: (record: SignedRecord) => void): () => void;
  /** A peer joined or left a bucket we are subscribed to. */
  onPeerPresence(handler: (peer: PeerId, bucket: BucketId, present: boolean) => void): () => void;
}

export interface IPeerNetwork extends IPeerNetworkEvents {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  /** Join a semantic bucket as both client and server. */
  joinBucket(bucket: BucketId): Promise<void>;

  /** Leave a bucket. No-op if not joined. */
  leaveBucket(bucket: BucketId): Promise<void>;

  /** Publish a signed record into our own append-only feed. */
  publish(record: SignedRecord): Promise<void>;

  /** Buckets currently joined. */
  readonly joinedBuckets: ReadonlyArray<BucketId>;
}
