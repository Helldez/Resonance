import type { BucketId, PeerId, SignedRecord } from '@core/domain/types';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';

/**
 * Bridge adapter: forwards all IPeerNetwork calls to the Bare worklet
 * running Hyperswarm + Hypercore. The worklet exposes a JSON-RPC surface;
 * we keep the wire contract in `qvac/worker.entry.mjs`.
 *
 * Stub for now — wired in Milestone 3.
 */
export class BareWorkletNetwork implements IPeerNetwork {
  private joined: BucketId[] = [];
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<
    (p: PeerId, b: BucketId, present: boolean) => void
  > = [];

  get joinedBuckets(): ReadonlyArray<BucketId> {
    return this.joined;
  }

  async initialize(): Promise<void> {
    // TODO M3: connect to the Bare worklet RPC channel here.
  }

  async shutdown(): Promise<void> {
    this.joined = [];
    this.recordHandlers = [];
    this.presenceHandlers = [];
  }

  async joinBucket(bucket: BucketId): Promise<void> {
    if (!this.joined.includes(bucket)) {
      this.joined.push(bucket);
    }
    // TODO M3: RPC -> worklet.joinBucket(bucket)
  }

  async leaveBucket(bucket: BucketId): Promise<void> {
    this.joined = this.joined.filter((b) => b !== bucket);
    // TODO M3: RPC -> worklet.leaveBucket(bucket)
  }

  async publish(_record: SignedRecord): Promise<void> {
    throw new Error('BareWorkletNetwork.publish: not implemented (M3)');
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
