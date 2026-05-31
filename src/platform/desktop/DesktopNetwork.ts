import type { PeerId, SignedRecord } from '@core/domain/types';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import type { DesktopP2pWorker } from './DesktopP2pWorker';

/**
 * Desktop counterpart of `BareWorkletNetwork`. Identical contract — only
 * the underlying worker handle differs (subprocess instead of worklet).
 */
export class DesktopNetwork implements IPeerNetwork {
  private joinedRoom = false;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<(p: PeerId, present: boolean) => void> = [];
  private detachRecord: (() => void) | null = null;
  private detachPresence: (() => void) | null = null;

  constructor(private readonly worker: DesktopP2pWorker) {}

  async initialize(): Promise<void> {
    await this.worker.initialize();
    this.detachRecord = this.worker.onRecord((record) => {
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    this.detachPresence = this.worker.onPresence((peerId, present) => {
      for (const h of this.presenceHandlers) {
        h(peerId, present);
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
    this.joinedRoom = false;
    this.recordHandlers = [];
    this.presenceHandlers = [];
  }

  async joinRoom(): Promise<void> {
    if (this.joinedRoom) {
      return;
    }
    await this.worker.joinRoom();
    this.joinedRoom = true;
  }

  async publish(_record: SignedRecord): Promise<void> {
    // Implicit: Hypercore replication + directory gossip propagate after
    // mailbox.append.
  }

  async rescan(): Promise<void> {
    await this.worker.rescan();
  }

  onRecord(handler: (record: SignedRecord) => void): () => void {
    this.recordHandlers.push(handler);
    return () => {
      this.recordHandlers = this.recordHandlers.filter((h) => h !== handler);
    };
  }

  onPeerPresence(handler: (peer: PeerId, present: boolean) => void): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }
}
