import { FramedRpcClient } from './FramedRpcClient';
import type { RpcTransportHandle } from './RpcTransport';
import {
  signedRecordToWire,
  wireToAnnouncement,
  wireToSignedRecord,
} from './WireCodec';
import type { WireAnnouncement, WireRecord } from './WireCodec';
import { RoomConfig } from '@core/config/RoomConfig';
import type { Announcement, PeerId, SignedRecord } from '@core/domain/types';

interface InitResult {
  readonly outboxKey: string;
  readonly noiseKey: string;
}

interface AnnouncementEvent {
  readonly announcement: WireAnnouncement;
}

interface AppendResult {
  readonly feedIndex: number;
}

interface OkResult {
  readonly ok: true;
}

interface RecordEvent {
  readonly record: WireRecord;
}

interface PresenceEvent {
  readonly peerId: string;
  readonly present: boolean;
}

export interface P2pWorkerOptions {
  /** How to start/stop the channel to the Bare worker (worklet or subprocess). */
  readonly transport: RpcTransportHandle;
  /** Absolute path to the Corestore directory on disk. */
  readonly storagePath: string;
}

/**
 * App-side handle to the Bare P2P worker — one class for both targets.
 * Owns the framed RPC channel over an injected `RpcTransportHandle`
 * (Worklet IPC on mobile, Bare subprocess on desktop) and translates
 * between the wire JSON format and the `SignedRecord` domain type via
 * `WireCodec`.
 */
export class P2pWorker {
  private transport: RpcTransportHandle | null = null;
  private rpc: FramedRpcClient | null = null;
  private outboxKey: string | null = null;
  private noiseKey: string | null = null;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private announcementHandlers: Array<(a: Announcement) => void> = [];
  private presenceHandlers: Array<(peerId: PeerId, present: boolean) => void> = [];

  constructor(private readonly options: P2pWorkerOptions) {}

  get isReady(): boolean {
    return this.outboxKey !== null;
  }

  get localNoiseKey(): string | null {
    return this.noiseKey;
  }

  async initialize(): Promise<void> {
    if (this.outboxKey !== null) {
      return;
    }
    const stream = await this.options.transport.start();
    const rpc = new FramedRpcClient(stream);

    rpc.on<RecordEvent>('record', (evt) => {
      if (evt === undefined) {
        return;
      }
      const record = wireToSignedRecord(evt.record);
      for (const h of this.recordHandlers) {
        h(record);
      }
    });
    rpc.on<AnnouncementEvent>('announcement', (evt) => {
      if (evt === undefined) {
        return;
      }
      const announcement = wireToAnnouncement(evt.announcement);
      for (const h of this.announcementHandlers) {
        h(announcement);
      }
    });
    rpc.on<PresenceEvent>('presence', (evt) => {
      if (evt === undefined) {
        return;
      }
      const peer = evt.peerId as PeerId;
      for (const h of this.presenceHandlers) {
        h(peer, evt.present);
      }
    });

    const initResult = await rpc.request<InitResult>('init', {
      storagePath: this.options.storagePath,
      maxConnections: RoomConfig.maxConnections,
      pullTimeoutMs: RoomConfig.pullTimeoutMs,
      announceBatchSize: RoomConfig.announceBatchSize,
    });

    this.transport = this.options.transport;
    this.rpc = rpc;
    this.outboxKey = initResult.outboxKey;
    this.noiseKey = initResult.noiseKey;
  }

  async shutdown(): Promise<void> {
    if (this.rpc !== null) {
      try {
        await this.rpc.request<OkResult>('shutdown', {});
      } catch {
        // best-effort
      }
    }
    if (this.transport !== null) {
      await this.transport.stop();
    }
    this.transport = null;
    this.rpc = null;
    this.outboxKey = null;
    this.noiseKey = null;
  }

  async append(record: SignedRecord): Promise<number> {
    const rpc = this.requireRpc();
    const wire = signedRecordToWire(record);
    const { feedIndex } = await rpc.request<AppendResult>('append', { record: wire });
    return feedIndex;
  }

  async joinRoom(): Promise<void> {
    const rpc = this.requireRpc();
    await rpc.request<OkResult>('joinRoom', {
      roomId: RoomConfig.roomId,
      topicSeed: RoomConfig.topicPrefix,
    });
  }

  async rescan(): Promise<void> {
    const rpc = this.requireRpc();
    await rpc.request<OkResult>('rescan', {});
  }

  async requestPull(author: PeerId, feedIndex: number): Promise<void> {
    const rpc = this.requireRpc();
    await rpc.request<{ ok: boolean }>('pull', { author, feedIndex });
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

  onPresence(handler: (peerId: PeerId, present: boolean) => void): () => void {
    this.presenceHandlers.push(handler);
    return () => {
      this.presenceHandlers = this.presenceHandlers.filter((h) => h !== handler);
    };
  }

  private requireRpc(): FramedRpcClient {
    if (this.rpc === null) {
      throw new Error('P2pWorker not initialised');
    }
    return this.rpc;
  }
}
