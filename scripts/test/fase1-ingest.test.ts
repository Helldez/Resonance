#!/usr/bin/env tsx
/**
 * Unit tests for the Phase-1 announce-then-pull core use-cases (pure):
 * scoreAgainstOwn, ingestAnnouncement, ingestPulledPost, rerankAnnouncements.
 * No DB, no network. Run via `npm test`.
 */
import assert from 'node:assert/strict';
import { scoreAgainstOwn } from '@core/inbox/ScoreAgainstOwn';
import { ingestAnnouncement } from '@core/inbox/IngestAnnouncement';
import { ingestPulledPost } from '@core/inbox/IngestPulledPost';
import { rerankAnnouncements } from '@core/inbox/RerankAnnouncements';
import type { Announcement, RecordAddress, PeerId, SignedRecord } from '@core/domain/types';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const addr = (s: string): RecordAddress => s as RecordAddress;
const peer = (s: string): PeerId => s as PeerId;
const config = { capacity: 3, minSimilarity: 0.3 };

/** Build an L2-normalised 2-D unit vector at angle `t` radians. */
function unit(t: number): Float32Array {
  return new Float32Array([Math.cos(t), Math.sin(t)]);
}

const ann = (over: Partial<Announcement> & Pick<Announcement, 'embedding'>): Announcement => ({
  author: peer('A'),
  feedIndex: 0,
  kind: 'post',
  createdAt: 0,
  digest: new Uint8Array([1, 2, 3]),
  ...over,
});

console.log('scoreAgainstOwn');

check('max cosine vs own posts wins, reports matched address', () => {
  const own = [
    { address: addr('own:0'), embedding: unit(0) },
    { address: addr('own:1'), embedding: unit(Math.PI / 2) },
  ];
  const r = scoreAgainstOwn(unit(0.05), own, null);
  assert.ok(r.similarity !== null && r.similarity > 0.99);
  assert.equal(r.matchedOwnAddress, addr('own:0'));
});

check('falls back to the interest profile when no own posts', () => {
  const r = scoreAgainstOwn(unit(0), [], unit(0));
  assert.ok(r.similarity !== null && r.similarity > 0.99);
  assert.equal(r.matchedOwnAddress, null);
});

check('null when neither own posts nor interest profile', () => {
  assert.equal(scoreAgainstOwn(unit(0), [], null).similarity, null);
});

console.log('ingestAnnouncement');

check('admits a similar post under capacity and asks to pull', () => {
  const own = [{ address: addr('own:0'), embedding: unit(0) }];
  const r = ingestAnnouncement({
    announcement: ann({ embedding: unit(0.05) }),
    ownEmbeddings: own,
    interestProfile: null,
    currentInboxCount: 0,
    inboxMin: null,
    config,
  });
  assert.equal(r.decision.kind, 'admit');
  assert.equal(r.shouldPull, true);
});

check('rejects a dissimilar post below threshold, no pull', () => {
  const own = [{ address: addr('own:0'), embedding: unit(0) }];
  const r = ingestAnnouncement({
    announcement: ann({ embedding: unit(Math.PI / 2) }), // orthogonal → cosine 0
    ownEmbeddings: own,
    interestProfile: null,
    currentInboxCount: 0,
    inboxMin: null,
    config,
  });
  assert.equal(r.decision.kind, 'reject-threshold');
  assert.equal(r.shouldPull, false);
});

check('non-post announcement always pulls, no scoring', () => {
  const r = ingestAnnouncement({
    announcement: ann({ kind: 'response', embedding: null }),
    ownEmbeddings: [],
    interestProfile: null,
    currentInboxCount: 0,
    inboxMin: null,
    config,
  });
  assert.equal(r.shouldPull, true);
  assert.equal(r.score.similarity, null);
});

console.log('ingestPulledPost');

const postRecord = (emb: Float32Array): SignedRecord => ({
  author: peer('A'),
  feedIndex: 1,
  body: { kind: 'post', text: 'hi', embedding: emb, createdAt: 0 },
  digest: new Uint8Array([1]),
  signature: new Uint8Array([2]),
});

check('re-scores the verified post and admits when it earns a slot', () => {
  const own = [{ address: addr('own:0'), embedding: unit(0) }];
  const r = ingestPulledPost({
    record: postRecord(unit(0.05)),
    ownEmbeddings: own,
    interestProfile: null,
    currentInboxCount: 0,
    inboxMin: null,
    config,
  });
  assert.equal(r.kind, 'post');
  assert.equal(r.kind === 'post' ? r.decision.kind : '', 'admit');
});

check('drops a verified post whose REAL embedding misses the threshold (closes S2)', () => {
  // The announcement could have lied with a high-scoring embedding to win a
  // tentative slot; the verified body is orthogonal, so it is rejected here.
  const own = [{ address: addr('own:0'), embedding: unit(0) }];
  const r = ingestPulledPost({
    record: postRecord(unit(Math.PI / 2)),
    ownEmbeddings: own,
    interestProfile: null,
    currentInboxCount: 0,
    inboxMin: null,
    config,
  });
  assert.equal(r.kind === 'post' ? r.decision.kind : '', 'reject-threshold');
});

check('a pulled response routes to the thread store', () => {
  const r = ingestPulledPost({
    record: {
      author: peer('A'),
      feedIndex: 2,
      body: { kind: 'response', text: 'x', inReplyTo: addr('A:1'), createdAt: 0 },
      digest: new Uint8Array([1]),
      signature: new Uint8Array([2]),
    },
    ownEmbeddings: [],
    interestProfile: null,
    currentInboxCount: 0,
    inboxMin: null,
    config,
  });
  assert.equal(r.kind, 'thread');
});

console.log('rerankAnnouncements');

check('re-scores all and queues only new top-K winners not yet pulled', () => {
  const own = [{ address: addr('own:0'), embedding: unit(0) }];
  const r = rerankAnnouncements({
    candidates: [
      { address: addr('A:0'), embedding: unit(0.05), pulled: false }, // strong, new → pull
      { address: addr('A:1'), embedding: unit(0.1), pulled: true }, // strong, already pulled → no
      { address: addr('A:2'), embedding: unit(Math.PI / 2), pulled: false }, // weak → no
    ],
    ownEmbeddings: own,
    interestProfile: null,
    config: { capacity: 3, minSimilarity: 0.3 },
  });
  assert.equal(r.scores.length, 3);
  assert.deepEqual([...r.toPull], [addr('A:0')]);
});

check('respects capacity: only the top-`capacity` qualify to pull', () => {
  const own = [{ address: addr('own:0'), embedding: unit(0) }];
  const r = rerankAnnouncements({
    candidates: [
      { address: addr('A:0'), embedding: unit(0.05), pulled: false },
      { address: addr('A:1'), embedding: unit(0.1), pulled: false },
      { address: addr('A:2'), embedding: unit(0.15), pulled: false },
    ],
    ownEmbeddings: own,
    interestProfile: null,
    config: { capacity: 2, minSimilarity: 0.3 },
  });
  assert.equal(r.toPull.length, 2); // strongest two only
});

console.log(`\n${passed} assertions passed.`);
