import bundle from '../../../bare/p2p.bundle.mjs';

import { Worklet } from 'react-native-bare-kit';
import { Paths } from 'expo-file-system';
import { FramedRpcClient } from './FramedRpcClient';
import { RoomConfig } from '@core/config/RoomConfig';
import { StorageConfig } from '@core/config/StorageConfig';
import type {
  Announcement,
  PeerId,
  RecordAddress,
  RecordKind,
  ReactionType,
  SignedRecord,
} from '@core/domain/types';

interface InitResult {
  readonly outboxKey: string;
  readonly noiseKey: string;
}

/** Wire form of an announcement (embedding as number[], digest as hex). */
interface WireAnnouncement {
  readonly outboxKey: string;
  readonly author: string;
  readonly feedIndex: number;
  readonly kind: RecordKind;
  readonly createdAt: number;
  readonly embedding: number[] | null;
  readonly digest: string;
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

interface WireReactionBody {
  readonly kind: 'reaction';
  readonly inReplyTo: string;
  readonly reaction: string;
  readonly createdAt: number;
}

type WireBody = WirePostBody | WireResponseBody | WireReactionBody;

interface WireRecord {
  readonly author: string;
  readonly feedIndex: number;
  readonly body: WireBody;
  readonly digest: string;
  readonly signature: string;
}

/**
 * RN-side handle to the Bare P2P worker. Owns the Worklet, the framed
 * RPC channel, and translates between the wire JSON format and the
 * project's `SignedRecord` domain type (embedding as number[], hex bytes).
 */
export class P2pWorklet {
  private worklet: Worklet | null = null;
  private rpc: FramedRpcClient | null = null;
  private outboxKey: string | null = null;
  private noiseKey: string | null = null;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private announcementHandlers: Array<(a: Announcement) => void> = [];
  private presenceHandlers: Array<(peerId: PeerId, present: boolean) => void> = [];

  get isReady(): boolean {
    return this.outboxKey !== null;
  }

  async initialize(): Promise<void> {
    if (this.outboxKey !== null) {
      return;
    }
    const worklet = new Worklet();
    worklet.start('/p2p.bundle', bundle);
    const rpc = new FramedRpcClient(worklet.IPC as unknown as ConstructorParameters<typeof FramedRpcClient>[0]);

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

    const docUri = Paths.document.uri;
    const docPath = docUri.startsWith('file://') ? docUri.slice('file://'.length) : docUri;
    const storagePath = `${docPath}${StorageConfig.corestoreDir}`;
    const initResult = await rpc.request<InitResult>('init', {
      storagePath,
      maxConnections: RoomConfig.maxConnections,
      pullTimeoutMs: RoomConfig.pullTimeoutMs,
    });

    this.worklet = worklet;
    this.rpc = rpc;
    this.outboxKey = initResult.outboxKey;
    this.noiseKey = initResult.noiseKey;
  }

  get localNoiseKey(): string | null {
    return this.noiseKey;
  }

  async shutdown(): Promise<void> {
    if (this.rpc !== null) {
      try {
        await this.rpc.request<OkResult>('shutdown', {});
      } catch {
        // best-effort
      }
    }
    if (this.worklet !== null) {
      this.worklet.terminate();
    }
    this.worklet = null;
    this.rpc = null;
    this.outboxKey = null;
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
      throw new Error('P2pWorklet not initialised');
    }
    return this.rpc;
  }
}

function wireToAnnouncement(wire: WireAnnouncement): Announcement {
  return {
    author: wire.author as PeerId,
    feedIndex: wire.feedIndex,
    kind: wire.kind,
    createdAt: wire.createdAt,
    embedding: wire.embedding === null ? null : new Float32Array(wire.embedding),
    digest: hexToBytes(wire.digest),
  };
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
  if (body.kind === 'reaction') {
    return {
      author: record.author,
      feedIndex: record.feedIndex,
      body: {
        kind: 'reaction',
        inReplyTo: String(body.inReplyTo),
        reaction: body.reaction,
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
  if (wire.body.kind === 'reaction') {
    return {
      author,
      feedIndex: wire.feedIndex,
      body: {
        kind: 'reaction',
        inReplyTo: wire.body.inReplyTo as RecordAddress,
        reaction: wire.body.reaction as ReactionType,
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
      inReplyTo: wire.body.inReplyTo as RecordAddress,
      createdAt: wire.body.createdAt,
    },
    digest,
    signature,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    hex += (b >>> 4).toString(16);
    hex += (b & 0xf).toString(16);
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
