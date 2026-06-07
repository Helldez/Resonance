import type { Announcement, PeerId, SignedRecord } from '@core/domain/types';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import type { P2pWorker } from './P2pWorker';

/**
 * Bridges the `IPeerNetwork` port onto the Bare P2P worker. All actual
 * Hyperswarm/Hypercore work happens in `bare/p2p.mjs`; this class is the
 * thin app-side facade, shared by mobile and desktop. In the single-room
 * model there is exactly one topic (the shared room), joined once via
 * `joinRoom`.
 */
export class P2pNetwork implements IPeerNetwork {
  private joinedRoom = false;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private announcementHandlers: Array<(a: Announcement) => void> = [];
  private presenceHandlers: Array<(p: PeerId, present: boolean) => void> = [];
  private detachRecord: (() => void) | null = null;
  private detachAnnouncement: (() => void) | null = null;
  private detachPresence: (() => void) | null = null;

  constructor(private readonly worker: P2pWorker) {}

  async initialize(): Promise<void> {
    await this.worker.initialize();
    this.detachRecord = this.worker.onRecord((record) => {
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    this.detachAnnouncement = this.worker.onAnnouncement((announcement) => {
      for (const h of this.announcementHandlers) {
        h(announcement);
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
    if (this.detachAnnouncement !== null) {
      this.detachAnnouncement();
      this.detachAnnouncement = null;
    }
    if (this.detachPresence !== null) {
      this.detachPresence();
      this.detachPresence = null;
    }
    this.joinedRoom = false;
    this.recordHandlers = [];
    this.announcementHandlers = [];
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
    // Publishing is implicit: the record is already in our outbox after
    // IMailbox.append(), and Hypercore replication + directory gossip
    // propagate it. Appending again here would write duplicate blocks.
  }

  async rescan(): Promise<void> {
    await this.worker.rescan();
  }

  async requestPull(author: PeerId, feedIndex: number): Promise<void> {
    await this.worker.requestPull(author, feedIndex);
  }

  onRecord(handler: (record: SignedRecord) => void): () => void {
    this.recordHandlers.push(handler);
    return () => {
      this.recordHandlers = this.recordHandlers.filter((h) => h !== handler);
    };
  }

  onAnnouncement(handler: (a: Announcement) => void): () => void {
    this.announcementHandlers.push(handler);
    return () => {
      this.announcementHandlers = this.announcementHandlers.filter((h) => h !== handler);
    };
  }

  onPeerPresence(handler: (peer: PeerId, present: boolean) => void): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }
}
