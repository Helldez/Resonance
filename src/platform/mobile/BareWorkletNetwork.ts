import type { PeerId, SignedRecord } from '@core/domain/types';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import type { P2pWorklet } from './P2pWorklet';

/**
 * Bridges the `IPeerNetwork` port onto the Bare P2P worker. All actual
 * Hyperswarm/Hypercore work happens in `bare/p2p.mjs`; this class is the
 * thin RN-side facade. In the single-room model there is exactly one topic
 * (the shared room), joined once via `joinRoom`.
 */
export class BareWorkletNetwork implements IPeerNetwork {
  private joinedRoom = false;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<(p: PeerId, present: boolean) => void> = [];
  private detachRecord: (() => void) | null = null;
  private detachPresence: (() => void) | null = null;

  constructor(private readonly worklet: P2pWorklet) {}

  async initialize(): Promise<void> {
    await this.worklet.initialize();
    this.detachRecord = this.worklet.onRecord((record) => {
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    this.detachPresence = this.worklet.onPresence((peerId, present) => {
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
    await this.worklet.joinRoom();
    this.joinedRoom = true;
  }

  async publish(_record: SignedRecord): Promise<void> {
    // Publishing is implicit: the record is already in our outbox after
    // IMailbox.append(), and Hypercore replication + directory gossip
    // propagate it. Appending again here would write duplicate blocks.
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
