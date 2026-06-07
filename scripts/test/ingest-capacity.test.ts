#!/usr/bin/env tsx
/**
 * Regression tests for the stress-test findings (400-post flood, 2026-06-07):
 * serialized admission respects the inbox capacity, already-pulled
 * announcements are not re-pulled, the boot trim self-heals an over-admitted
 * inbox, and record addresses round-trip. Uses the production repositories
 * over the real `node:sqlite` driver (`:memory:`). Run via `npm test`.
 */
import assert from 'node:assert/strict';
import { NodeSqliteDatabase } from '@platform/desktop/NodeSqliteDatabase';
import { PostRepository } from '@data/PostRepository';
import { AnnouncementRepository } from '@data/AnnouncementRepository';
import { decideAdmission } from '@core/inbox/InboxAdmission';
import { addressOf, parseAddress } from '@core/utils/AddressOf';
import type { Announcement, PeerId, PostBody, RecordAddress } from '@core/domain/types';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const SELF = 'selfselfself' as PeerId;
const REMOTE = 'aaaa1111bbbb' as PeerId;
const DIM = 4;
const CAPACITY = 5;

const post = (similarity: number): PostBody => ({
  kind: 'post',
  text: `post at ${similarity}`,
  embedding: new Float32Array(DIM),
  createdAt: 0,
});

const ann = (feedIndex: number): Announcement => ({
  author: REMOTE,
  feedIndex,
  kind: 'post',
  createdAt: 0,
  embedding: new Float32Array(DIM),
  digest: new Uint8Array([1]),
});

async function freshDb(): Promise<{
  posts: PostRepository;
  announcements: AnnouncementRepository;
}> {
  const db = new NodeSqliteDatabase(':memory:');
  await db.initialize();
  const posts = new PostRepository(db);
  const announcements = new AnnouncementRepository(db);
  await posts.createSchema();
  await announcements.createSchema();
  return { posts, announcements };
}

async function main(): Promise<void> {
  console.log('parseAddress');

  await check('round-trips addressOf', () => {
    const address = addressOf(REMOTE, 42);
    const back = parseAddress(address);
    assert.equal(back.author, REMOTE);
    assert.equal(back.feedIndex, 42);
  });

  await check('throws on a malformed address', () => {
    assert.throws(() => parseAddress('no-separator' as RecordAddress));
    assert.throws(() => parseAddress('peer:notanumber' as RecordAddress));
  });

  console.log('AnnouncementRepository.isPulled');

  await check('false before pull, true after markPulled', async () => {
    const { announcements } = await freshDb();
    const a = ann(0);
    const address = addressOf(a.author, a.feedIndex);
    await announcements.upsert(a, 0.5);
    assert.equal(await announcements.isPulled(address), false);
    await announcements.markPulled(address);
    assert.equal(await announcements.isPulled(address), true);
  });

  await check('a re-announcement upsert preserves the pulled flag', async () => {
    const { announcements } = await freshDb();
    const a = ann(1);
    const address = addressOf(a.author, a.feedIndex);
    await announcements.upsert(a, 0.5);
    await announcements.markPulled(address);
    await announcements.upsert(a, 0.9); // re-gossip of the same record
    assert.equal(await announcements.isPulled(address), true);
  });

  console.log('PostRepository.enforceRemoteCapacity');

  await check('trims weakest-first back to capacity, nulls evicted first', async () => {
    const { posts } = await freshDb();
    // 8 remote posts: two unscored (null), six scored 0.4..0.9. Cap 5 →
    // evict the two nulls and the weakest scored (0.4).
    const sims: Array<number | null> = [null, null, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    for (let i = 0; i < sims.length; i++) {
      await posts.upsert(addressOf(REMOTE, i), REMOTE, i, post(sims[i] ?? 0), sims[i]);
    }
    await posts.upsert(addressOf(SELF, 0), SELF, 0, post(0), null); // own, exempt
    const removed = await posts.enforceRemoteCapacity(SELF, CAPACITY);
    assert.equal(removed, 3);
    assert.equal(await posts.countRemotePosts(SELF), CAPACITY);
    const min = await posts.minSimilarityRemotePost(SELF);
    assert.ok(min !== null && min.similarity >= 0.5);
  });

  await check('no-op when already within capacity', async () => {
    const { posts } = await freshDb();
    await posts.upsert(addressOf(REMOTE, 0), REMOTE, 0, post(0.5), 0.5);
    assert.equal(await posts.enforceRemoteCapacity(SELF, CAPACITY), 0);
    assert.equal(await posts.countRemotePosts(SELF), 1);
  });

  console.log('serialized admission burst');

  await check('a burst processed through a serial queue never exceeds capacity', async () => {
    const { posts } = await freshDb();
    const config = { capacity: CAPACITY, minSimilarity: 0.3 };

    // The production persist path for one pulled post (persistRecord's post
    // branch): read committed state, decide, evict, upsert.
    const persistOne = async (feedIndex: number, similarity: number): Promise<void> => {
      const currentCount = await posts.countRemotePosts(SELF);
      const min = await posts.minSimilarityRemotePost(SELF);
      const decision = decideAdmission({ similarity, currentCount, min, config });
      if (decision.kind === 'reject-threshold' || decision.kind === 'reject-full') {
        return;
      }
      if (decision.kind === 'replace') {
        await posts.delete(decision.evict);
      }
      await posts.upsert(addressOf(REMOTE, feedIndex), REMOTE, feedIndex, post(similarity), similarity);
    };

    // 50 records land "at once"; the queue chains them exactly like
    // `enqueueIngest` does, so each decision sees the previous commit.
    let queue: Promise<void> = Promise.resolve();
    for (let i = 0; i < 50; i++) {
      const similarity = 0.31 + (i % 40) * 0.015;
      queue = queue.then(() => persistOne(i, similarity));
    }
    await queue;

    const count = await posts.countRemotePosts(SELF);
    assert.ok(count <= CAPACITY, `inbox grew to ${count}, cap is ${CAPACITY}`);
    // The survivors are the strongest seen, not the first-come.
    const min = await posts.minSimilarityRemotePost(SELF);
    assert.ok(min !== null && min.similarity > 0.8, `weakest survivor ${min?.similarity}`);
  });

  console.log(`\n${passed} assertions passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
