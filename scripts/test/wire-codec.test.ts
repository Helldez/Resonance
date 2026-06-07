#!/usr/bin/env tsx
/**
 * Round-trip tests for the shared wire codec (`@platform/shared/WireCodec`).
 * The codec is the app-side half of the protocol spoken with `bare/p2p.mjs`;
 * these checks pin the wire shape so the mobile/desktop worker consolidation
 * (one `P2pWorker` for both targets) cannot silently change it.
 * Self-contained (tsx + node:assert), no DB/network.
 */
import assert from 'node:assert/strict';
import {
  signedRecordToWire,
  wireToSignedRecord,
  wireToAnnouncement,
} from '@platform/shared/WireCodec';
import type { WireAnnouncement } from '@platform/shared/WireCodec';
import type { PeerId, RecordAddress, SignedRecord } from '@core/domain/types';
import { bytesToHex } from '@core/utils/HexEncoding';

const AUTHOR = 'aa'.repeat(32) as PeerId;
const TARGET = `${'bb'.repeat(32)}:7` as RecordAddress;
const DIGEST = new Uint8Array([1, 2, 3, 0xff]);
const SIGNATURE = new Uint8Array([9, 8, 7, 0x00, 0x10]);

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function roundTrip(record: SignedRecord): SignedRecord {
  return wireToSignedRecord(signedRecordToWire(record));
}

console.log('WireCodec round-trip');

check('post record survives the round-trip (embedding, digest, signature)', () => {
  const record: SignedRecord = {
    author: AUTHOR,
    feedIndex: 3,
    body: {
      kind: 'post',
      text: 'hello room',
      embedding: new Float32Array([0.25, -0.5, 1]),
      createdAt: 1717171717,
    },
    digest: DIGEST,
    signature: SIGNATURE,
  };
  const back = roundTrip(record);
  assert.deepEqual(back, record);
  assert.ok(back.body.kind === 'post' && back.body.embedding instanceof Float32Array);
});

check('response record survives the round-trip (inReplyTo preserved)', () => {
  const record: SignedRecord = {
    author: AUTHOR,
    feedIndex: 4,
    body: {
      kind: 'response',
      text: 'a reply',
      inReplyTo: TARGET,
      createdAt: 1717171718,
    },
    digest: DIGEST,
    signature: SIGNATURE,
  };
  assert.deepEqual(roundTrip(record), record);
});

check('reaction record survives the round-trip', () => {
  const record: SignedRecord = {
    author: AUTHOR,
    feedIndex: 5,
    body: {
      kind: 'reaction',
      inReplyTo: TARGET,
      reaction: 'like',
      createdAt: 1717171719,
    },
    digest: DIGEST,
    signature: SIGNATURE,
  };
  assert.deepEqual(roundTrip(record), record);
});

check('wire field names match the bare/p2p.mjs protocol exactly', () => {
  const wire = signedRecordToWire({
    author: AUTHOR,
    feedIndex: 3,
    body: {
      kind: 'post',
      text: 'hello room',
      embedding: new Float32Array([0.5]),
      createdAt: 1,
    },
    digest: DIGEST,
    signature: SIGNATURE,
  });
  assert.deepEqual(Object.keys(wire).sort(), ['author', 'body', 'digest', 'feedIndex', 'signature']);
  assert.deepEqual(Object.keys(wire.body).sort(), ['createdAt', 'embedding', 'kind', 'text']);
  assert.equal(wire.digest, bytesToHex(DIGEST));
  assert.equal(wire.signature, bytesToHex(SIGNATURE));
  assert.deepEqual(wire.body.kind === 'post' ? wire.body.embedding : null, [0.5]);
});

console.log('wireToAnnouncement');

check('post announcement decodes embedding and digest', () => {
  const wire: WireAnnouncement = {
    outboxKey: 'cc'.repeat(32),
    author: AUTHOR,
    feedIndex: 12,
    kind: 'post',
    createdAt: 1717171720,
    embedding: [0.1, 0.2],
    digest: bytesToHex(DIGEST),
  };
  const ann = wireToAnnouncement(wire);
  assert.equal(ann.author, AUTHOR);
  assert.equal(ann.feedIndex, 12);
  assert.equal(ann.kind, 'post');
  assert.ok(ann.embedding instanceof Float32Array);
  assert.deepEqual(Array.from(ann.embedding!), [new Float32Array([0.1])[0], new Float32Array([0.2])[0]]);
  assert.deepEqual(ann.digest, DIGEST);
});

check('non-post announcement keeps a null embedding', () => {
  const wire: WireAnnouncement = {
    outboxKey: 'cc'.repeat(32),
    author: AUTHOR,
    feedIndex: 13,
    kind: 'reaction',
    createdAt: 1717171721,
    embedding: null,
    digest: bytesToHex(DIGEST),
  };
  assert.equal(wireToAnnouncement(wire).embedding, null);
});

console.log(`\n${passed} assertions passed.`);
