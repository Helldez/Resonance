#!/usr/bin/env tsx
/**
 * Round-trip tests for the resonance-announce/v2 binary codec
 * (bare/announce-codec.mjs) — the fix for the snapshot-kills-connection bug:
 * a 1063-announcement snapshot was ~15.6MB as JSON in ONE message, above the
 * transport frame cap. Binary + batching bound every message. Run via `npm test`.
 */
import assert from 'node:assert/strict';
import c from 'compact-encoding';
// @ts-expect-error plain-JS bare module without type declarations
import { announcementBatch, announcementCodec } from '../../bare/announce-codec.mjs';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const hex32 = (seed: number): string => seed.toString(16).padStart(2, '0').repeat(32);

const makeAnn = (feedIndex: number, withEmbedding: boolean) => ({
  outboxKey: hex32(0xab),
  author: hex32(0xcd),
  feedIndex,
  kind: withEmbedding ? 'post' : 'reaction',
  createdAt: 1765000000000,
  embedding: withEmbedding
    ? Array.from({ length: 768 }, (_, i) => Math.fround(Math.sin(i * 0.37) * 0.05))
    : null,
  digest: hex32(0xef),
});

console.log('announcementCodec');

check('round-trips a post announcement with a 768-dim embedding', () => {
  const ann = makeAnn(42, true);
  const buf = c.encode(announcementCodec, ann);
  const back = c.decode(announcementCodec, buf);
  assert.equal(back.outboxKey, ann.outboxKey);
  assert.equal(back.author, ann.author);
  assert.equal(back.feedIndex, 42);
  assert.equal(back.kind, 'post');
  assert.equal(back.createdAt, ann.createdAt);
  assert.equal(back.digest, ann.digest);
  assert.equal(back.embedding.length, 768);
  // float32 exactness: inputs were fround'ed, so the trip must be lossless
  assert.deepEqual(back.embedding, ann.embedding);
});

check('round-trips a non-post announcement (null embedding)', () => {
  const ann = makeAnn(7, false);
  const back = c.decode(announcementCodec, c.encode(announcementCodec, ann));
  assert.equal(back.kind, 'reaction');
  assert.equal(back.embedding, null);
});

check('binary post announcement is ~3.2KB, ~5x smaller than JSON', () => {
  const ann = makeAnn(1, true);
  const binary = c.encode(announcementCodec, ann).byteLength;
  const json = JSON.stringify(ann).length;
  assert.ok(binary < 3400, `binary ${binary}B should be ~3.2KB`);
  assert.ok(json / binary > 3, `JSON ${json}B should dwarf binary ${binary}B`);
});

check('a 100-announcement batch round-trips and stays under 350KB', () => {
  const batch = Array.from({ length: 100 }, (_, i) => makeAnn(i, true));
  const buf = c.encode(announcementBatch, batch);
  assert.ok(buf.byteLength < 350_000, `batch is ${buf.byteLength}B`);
  const back = c.decode(announcementBatch, buf);
  assert.equal(back.length, 100);
  assert.deepEqual(back[99], batch[99]);
});

console.log(`\n${passed} assertions passed.`);
