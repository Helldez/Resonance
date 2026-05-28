import type { BucketId, PeerId, SignedRecord } from '@core/domain/types';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import type { DesktopP2pWorker } from './DesktopP2pWorker';

/**
 * Desktop counterpart of `BareWorkletNetwork`. Identical contract — only
 * the underlying worker handle differs (subprocess instead of worklet).
 */
export class DesktopNetwork implements IPeerNetwork {
  private joined: BucketId[] = [];
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<
    (p: PeerId, b: BucketId, present: boolean) => void
  > = [];
  private detachRecord: (() => void) | null = null;
  private detachPresence: (() => void) | null = null;

  constructor(private readonly worker: DesktopP2pWorker) {}

  get joinedBuckets(): ReadonlyArray<BucketId> {
    return this.joined;
  }

  async initialize(): Promise<void> {
    await this.worker.initialize();
    this.detachRecord = this.worker.onRecord((record) => {
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    this.detachPresence = this.worker.onPresence((peerId, present) => {
      const bucket =
        this.joined.length > 0 ? this.joined[this.joined.length - 1] : ('' as BucketId);
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
    await this.worker.joinBucket(bucket);
    this.joined.push(bucket);
  }

  async leaveBucket(bucket: BucketId): Promise<void> {
    if (!this.joined.includes(bucket)) {
      return;
    }
    await this.worker.leaveBucket(bucket);
    this.joined = this.joined.filter((b) => b !== bucket);
  }

  async publish(_record: SignedRecord): Promise<void> {
    // Implicit: Hypercore replication propagates after mailbox.append.
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
