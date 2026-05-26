import type { BucketId, PeerId, SignedRecord } from '@core/domain/types';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import type { P2pWorklet } from './P2pWorklet';

/**
 * Bridges the `IPeerNetwork` port onto the Bare P2P worker. All actual
 * Hyperswarm/Hypercore work happens in `bare/p2p.mjs`; this class is the
 * thin RN-side facade.
 */
export class BareWorkletNetwork implements IPeerNetwork {
  private joined: BucketId[] = [];
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<
    (p: PeerId, b: BucketId, present: boolean) => void
  > = [];
  private detachRecord: (() => void) | null = null;
  private detachPresence: (() => void) | null = null;

  constructor(private readonly worklet: P2pWorklet) {}

  get joinedBuckets(): ReadonlyArray<BucketId> {
    return this.joined;
  }

  async initialize(): Promise<void> {
    await this.worklet.initialize();
    this.detachRecord = this.worklet.onRecord((record) => {
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    // Presence is currently emitted without an associated bucket id, so we
    // surface it against the last-joined bucket. Future iterations can
    // carry the bucket through the worker event.
    this.detachPresence = this.worklet.onPresence((peerId, present) => {
      const bucket = this.joined.length > 0 ? this.joined[this.joined.length - 1] : ('' as BucketId);
      for (const h of this.presenceHandlers) {
        h(peerId, bucket, present);
      }
    });
  }

  async shutdown(): Promise<void> {
    if (this.detachRecord !== null) {
      this.detachRecord();
      this.detachRecord = null;
    }
    if (this.detachPresence !== null) {
      this.detachPresence();
      this.detachPresence = null;
    }
    this.joined = [];
    this.recordHandlers = [];
    this.presenceHandlers = [];
  }

  async joinBucket(bucket: BucketId): Promise<void> {
    if (this.joined.includes(bucket)) {
      return;
    }
    await this.worklet.joinBucket(bucket);
    this.joined.push(bucket);
  }

  async leaveBucket(bucket: BucketId): Promise<void> {
    if (!this.joined.includes(bucket)) {
      return;
    }
    await this.worklet.leaveBucket(bucket);
    this.joined = this.joined.filter((b) => b !== bucket);
  }

  async publish(record: SignedRecord): Promise<void> {
    // Publishing IS the append to the local outbox — replication propagates
    // automatically through Corestore once peers are connected.
    await this.worklet.append(record);
  }

  onRecord(handler: (record: SignedRecord) => void): () => void {
    this.recordHandlers.push(handler);
    return () => {
      this.recordHandlers = this.recordHandlers.filter((h) => h !== handler);
    };
  }

  onPeerPresence(
    handler: (peer: PeerId, bucket: BucketId, present: boolean) => void,
  ): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }
}
