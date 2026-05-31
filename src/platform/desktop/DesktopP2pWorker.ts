import { BareSubprocess } from './BareSubprocess';
import { FramedRpcClient } from './FramedRpcClient';
import { RoomConfig } from '@core/config/RoomConfig';
import type { PeerId, SignedRecord } from '@core/domain/types';
import { bytesToHex, hexToBytes } from '@core/utils/HexEncoding';

interface InitResult {
  readonly outboxKey: string;
  readonly noiseKey: string;
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

interface WirePostBody {
  readonly kind: 'post';
  readonly text: string;
  readonly embedding: number[];
  readonly createdAt: number;
}

interface WireResponseBody {
  readonly kind: 'response';
  readonly text: string;
  readonly inReplyTo: string;
  readonly createdAt: number;
}

type WireBody = WirePostBody | WireResponseBody;

interface WireRecord {
  readonly author: string;
  readonly feedIndex: number;
  readonly body: WireBody;
  readonly digest: string;
  readonly signature: string;
}

export interface DesktopP2pWorkerOptions {
  /** Absolute path to the Bare desktop entry file. */
  readonly entryPath: string;
  /** Absolute path to the Corestore directory on disk. */
  readonly storagePath: string;
}

/**
 * Desktop counterpart of `P2pWorklet`. Spawns the Bare P2P worker as a
 * child process via `BareSubprocess`, wraps stdin/stdout in a
 * `FramedRpcClient`, and exposes the same surface (init, append, joinRoom,
 * event handlers).
 *
 * The wire format and command set are identical to the mobile path, so the
 * network and mailbox adapters above this class are unchanged relative to
 * the mobile ones.
 */
export class DesktopP2pWorker {
  private subprocess: BareSubprocess | null = null;
  private rpc: FramedRpcClient | null = null;
  private outboxKey: string | null = null;
  private noiseKey: string | null = null;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<(peerId: PeerId, present: boolean) => void> = [];

  constructor(private readonly options: DesktopP2pWorkerOptions) {}

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
    const sub = new BareSubprocess({ entryPath: this.options.entryPath });
    await sub.start();
    const rpc = new FramedRpcClient(sub);

    rpc.on<RecordEvent>('record', (evt) => {
      if (evt === undefined) {
        return;
      }
      const record = wireToSignedRecord(evt.record);
      for (const h of this.recordHandlers) {
        h(record);
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
    });

    this.subprocess = sub;
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
    if (this.subprocess !== null) {
      await this.subprocess.stop();
    }
    this.subprocess = null;
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

  onRecord(handler: (record: SignedRecord) => void): () => void {
    this.recordHandlers.push(handler);
    return () => {
      this.recordHandlers = this.recordHandlers.filter((h) => h !== handler);
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
      throw new Error('DesktopP2pWorker: not initialized');
    }
    return this.rpc;
  }
}

function signedRecordToWire(record: SignedRecord): WireRecord {
  const body = record.body;
  if (body.kind === 'post') {
    return {
      author: record.author,
      feedIndex: record.feedIndex,
      body: {
        kind: 'post',
        text: body.text,
        embedding: Array.from(body.embedding),
        createdAt: body.createdAt,
      },
      digest: bytesToHex(record.digest),
      signature: bytesToHex(record.signature),
    };
  }
  return {
    author: record.author,
    feedIndex: record.feedIndex,
    body: {
      kind: 'response',
      text: body.text,
      inReplyTo: String(body.inReplyTo),
      createdAt: body.createdAt,
    },
    digest: bytesToHex(record.digest),
    signature: bytesToHex(record.signature),
  };
}

function wireToSignedRecord(wire: WireRecord): SignedRecord {
  const digest = hexToBytes(wire.digest);
  const signature = hexToBytes(wire.signature);
  const author = wire.author as PeerId;
  if (wire.body.kind === 'post') {
    return {
      author,
      feedIndex: wire.feedIndex,
      body: {
        kind: 'post',
        text: wire.body.text,
        embedding: new Float32Array(wire.body.embedding),
        createdAt: wire.body.createdAt,
      },
      digest,
      signature,
    };
  }
  return {
    author,
    feedIndex: wire.feedIndex,
    body: {
      kind: 'response',
      text: wire.body.text,
      inReplyTo: wire.body.inReplyTo as SignedRecord['body'] extends { inReplyTo: infer T } ? T : never,
      createdAt: wire.body.createdAt,
    },
    digest,
    signature,
  };
}
