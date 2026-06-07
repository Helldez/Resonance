#!/usr/bin/env tsx
/**
 * Tests for the unified `P2pWorker` driven through a MOCK `RpcTransportHandle`
 * (in-memory framed-JSON echo). This is the safety net for the worklet/
 * subprocess consolidation: init handshake, append framing, event dispatch
 * and shutdown semantics are asserted without any Bare runtime.
 * Self-contained (tsx + node:assert), no DB/network.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { P2pWorker } from '@platform/shared/P2pWorker';
import type { RpcTransport, RpcTransportHandle } from '@platform/shared/RpcTransport';
import { signedRecordToWire } from '@platform/shared/WireCodec';
import { RoomConfig } from '@core/config/RoomConfig';
import type { PeerId, SignedRecord } from '@core/domain/types';

const OUTBOX_KEY = 'ab'.repeat(32);
const NOISE_KEY = 'cd'.repeat(32);

interface RpcMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

/**
 * In-memory transport speaking the framed wire format
 * (<4-byte BE length><JSON>). Records every request and answers via a
 * per-method responder table; `emit` injects worker→app event frames.
 */
class MockTransport implements RpcTransport {
  readonly requests: RpcMessage[] = [];
  private dataHandlers: Array<(chunk: Uint8Array) => void> = [];
  private buffer = new Uint8Array(0);

  constructor(
    private readonly respond: (method: string, params: Record<string, unknown>) => unknown,
  ) {}

  on(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    this.dataHandlers.push(handler);
  }

  write(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.length);
    this.buffer = next;
    while (this.buffer.length >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const len = view.getUint32(0, false);
      if (this.buffer.length < 4 + len) {
        return;
      }
      const payload = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      const msg = JSON.parse(Buffer.from(payload).toString('utf8')) as RpcMessage;
      this.requests.push(msg);
      if (typeof msg.id === 'number' && typeof msg.method === 'string') {
        const result = this.respond(msg.method, msg.params ?? {});
        this.emitFrame({ id: msg.id, ok: true, result });
      }
    }
  }

  /** Inject a worker→app event frame ({event, payload}). */
  emit(event: string, payload: unknown): void {
    this.emitFrame({ event, payload });
  }

  private emitFrame(obj: Record<string, unknown>): void {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const frame = Buffer.alloc(4 + json.length);
    frame.writeUInt32BE(json.length, 0);
    json.copy(frame, 4);
    const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    for (const h of this.dataHandlers) {
      h(bytes);
    }
  }
}

class MockHandle implements RpcTransportHandle {
  readonly transport: MockTransport;
  startCalls = 0;
  stopCalls = 0;

  constructor() {
    this.transport = new MockTransport((method) => {
      if (method === 'init') {
        return { outboxKey: OUTBOX_KEY, noiseKey: NOISE_KEY };
      }
      if (method === 'append') {
        return { feedIndex: 41 };
      }
      return { ok: true };
    });
  }

  async start(): Promise<RpcTransport> {
    this.startCalls += 1;
    return this.transport;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

const AUTHOR = 'aa'.repeat(32) as PeerId;
const POST: SignedRecord = {
  author: AUTHOR,
  feedIndex: 41,
  body: {
    kind: 'post',
    text: 'hello',
    embedding: new Float32Array([1, 0]),
    createdAt: 123,
  },
  digest: new Uint8Array([1, 2]),
  signature: new Uint8Array([3, 4]),
};

let passed = 0;
function check(name: string, ok: boolean): void {
  assert.ok(ok, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  console.log('P2pWorker over a mock transport');

  const handle = new MockHandle();
  const worker = new P2pWorker({ transport: handle, storagePath: '/tmp/corestore' });

  check('not ready before initialize', !worker.isReady);

  await worker.initialize();
  check('initialize starts the transport once', handle.startCalls === 1);
  check('ready after init handshake', worker.isReady);
  check('noise key exposed from init result', worker.localNoiseKey === NOISE_KEY);
  const init = handle.transport.requests.find((r) => r.method === 'init');
  assert.ok(init !== undefined);
  check(
    'init carries storagePath + RoomConfig knobs',
    init.params?.storagePath === '/tmp/corestore' &&
      init.params?.maxConnections === RoomConfig.maxConnections &&
      init.params?.pullTimeoutMs === RoomConfig.pullTimeoutMs,
  );

  await worker.initialize();
  check('initialize is idempotent (no second transport start)', handle.startCalls === 1);

  const feedIndex = await worker.append(POST);
  check('append resolves the worker-assigned feedIndex', feedIndex === 41);
  const append = handle.transport.requests.find((r) => r.method === 'append');
  assert.ok(append !== undefined);
  check(
    'append sends the record in wire form (hex digest, number[] embedding)',
    JSON.stringify(append.params?.record) === JSON.stringify(signedRecordToWire(POST)),
  );

  await worker.joinRoom();
  const join = handle.transport.requests.find((r) => r.method === 'joinRoom');
  assert.ok(join !== undefined);
  check(
    'joinRoom sends roomId + topicSeed from RoomConfig',
    join.params?.roomId === RoomConfig.roomId && join.params?.topicSeed === RoomConfig.topicPrefix,
  );

  await worker.requestPull(AUTHOR, 9);
  const pull = handle.transport.requests.find((r) => r.method === 'pull');
  check('pull carries author + feedIndex', pull?.params?.author === AUTHOR && pull?.params?.feedIndex === 9);

  // Event dispatch: inject frames as the Bare worker would emit them.
  const seenRecords: SignedRecord[] = [];
  const seenAnnouncements: number[] = [];
  const seenPresence: Array<[PeerId, boolean]> = [];
  const offRecord = worker.onRecord((r) => seenRecords.push(r));
  worker.onAnnouncement((a) => seenAnnouncements.push(a.feedIndex));
  worker.onPresence((p, present) => seenPresence.push([p, present]));

  handle.transport.emit('record', { record: signedRecordToWire(POST) });
  check('record event decodes back to the domain record', JSON.stringify(seenRecords[0]?.body) === JSON.stringify(POST.body));

  handle.transport.emit('announcement', {
    announcement: {
      outboxKey: OUTBOX_KEY,
      author: AUTHOR,
      feedIndex: 5,
      kind: 'post',
      createdAt: 1,
      embedding: [1, 0],
      digest: '0102',
    },
  });
  check('announcement event dispatches', seenAnnouncements[0] === 5);

  handle.transport.emit('presence', { peerId: AUTHOR, present: true });
  check('presence event dispatches', seenPresence[0]?.[0] === AUTHOR && seenPresence[0]?.[1] === true);

  offRecord();
  handle.transport.emit('record', { record: signedRecordToWire(POST) });
  check('detached record handler no longer fires', seenRecords.length === 1);

  await worker.shutdown();
  const shutdown = handle.transport.requests.find((r) => r.method === 'shutdown');
  check('shutdown sends the shutdown RPC', shutdown !== undefined);
  check('shutdown stops the transport', handle.stopCalls === 1);
  check('not ready after shutdown', !worker.isReady && worker.localNoiseKey === null);

  console.log(`\n${passed} assertions passed.`);
}

void main();
