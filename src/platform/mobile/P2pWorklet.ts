import bundle from '../../../bare/p2p.bundle.mjs';

import { Worklet } from 'react-native-bare-kit';
import { Paths } from 'expo-file-system';
import { FramedRpcClient } from './FramedRpcClient';
import { NetworkConfig } from '@core/config/NetworkConfig';
import { StorageConfig } from '@core/config/StorageConfig';
import type { BucketId, PeerId, SignedRecord } from '@core/domain/types';

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

interface PeerNoiseEvent {
  readonly peerId: string;
  readonly noiseKey: string;
}

interface WirePostBody {
  readonly kind: 'post';
  readonly text: string;
  readonly embedding: number[];
  readonly bucket: string;
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

/**
 * RN-side handle to the Bare P2P worker. Owns the Worklet, the framed
 * RPC channel, and translates between the wire JSON format and the
 * project's `SignedRecord` domain type (embedding base64, hex bytes).
 */
export class P2pWorklet {
  private worklet: Worklet | null = null;
  private rpc: FramedRpcClient | null = null;
  private outboxKey: string | null = null;
  private noiseKey: string | null = null;
  private recordHandlers: Array<(r: SignedRecord) => void> = [];
  private presenceHandlers: Array<(peerId: PeerId, present: boolean) => void> = [];
  private peerNoiseHandlers: Array<(peerId: string, noiseKey: string) => void> = [];

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
    rpc.on<PresenceEvent>('presence', (evt) => {
      if (evt === undefined) {
        return;
      }
      const peer = evt.peerId as PeerId;
      for (const h of this.presenceHandlers) {
        h(peer, evt.present);
      }
    });
    rpc.on<PeerNoiseEvent>('peerNoise', (evt) => {
      if (evt === undefined) {
        return;
      }
      for (const h of this.peerNoiseHandlers) {
        h(evt.peerId, evt.noiseKey);
      }
    });

    const storagePath = `${Paths.document.uri.replace(/^file:\/\//, '')}${StorageConfig.corestoreDir}`;
    const initResult = await rpc.request<InitResult>('init', { storagePath });

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

  async joinBucket(bucket: BucketId): Promise<void> {
    const rpc = this.requireRpc();
    await rpc.request<OkResult>('joinBucket', {
      bucketId: String(bucket),
      topicSeed: NetworkConfig.topicPrefix,
    });
  }

  async leaveBucket(bucket: BucketId): Promise<void> {
    const rpc = this.requireRpc();
    await rpc.request<OkResult>('leaveBucket', { bucketId: String(bucket) });
  }

  /**
   * Tell the swarm to maintain a direct connection to a peer identified
   * by their Hyperswarm noise public key (hex). Used for sticky peers:
   * once we have learned a peer's noise key during a swarm topic
   * connection, we call this on every boot so the connection survives
   * bucket changes on either side.
   */
  async joinPeer(noiseKey: string): Promise<void> {
    const rpc = this.requireRpc();
    await rpc.request<OkResult>('joinPeer', { noiseKey });
  }

  onPeerNoise(handler: (peerId: string, noiseKey: string) => void): () => void {
    this.peerNoiseHandlers.push(handler);
    return () => {
      this.peerNoiseHandlers = this.peerNoiseHandlers.filter((h) => h !== handler);
    };
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
      throw new Error('P2pWorklet not initialised');
    }
    return this.rpc;
  }
}

function signedRecordToWire(record: SignedRecord): WireRecord {
  const body = record.body;
  if (body.kind === 'post') {
    const embeddingArr = Array.from(body.embedding);
    return {
      author: record.author,
      feedIndex: record.feedIndex,
      body: {
        kind: 'post',
        text: body.text,
        embedding: embeddingArr,
        bucket: String(body.bucket),
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
    const embedding = new Float32Array(wire.body.embedding);
    return {
      author,
      feedIndex: wire.feedIndex,
      body: {
        kind: 'post',
        text: wire.body.text,
        embedding,
        bucket: wire.body.bucket as BucketId,
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
