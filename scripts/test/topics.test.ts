#!/usr/bin/env tsx
/**
 * Unit tests for spherical k-means, the topic atlas projection, and the
 * optional LLM topic-naming pass. Run via `npm test`.
 */
import assert from 'node:assert/strict';
import { sphericalKMeans } from '@core/topics/SphericalKMeans';
import { computeTopicAtlas } from '@core/topics/TopicAtlas';
import type { AtlasPostInput } from '@core/topics/TopicAtlas';
import { nameTopics } from '@core/topics/NameTopics';
import type { ILlmService, LlmGenerateOptions } from '@core/ports/ILlmService';
import type { PeerId, RecordAddress } from '@core/domain/types';

function unit(v: number[]): Float32Array {
  const a = new Float32Array(v);
  let s = 0;
  for (const x of a) s += x * x;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= n;
  return a;
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Two well-separated groups along orthogonal axes.
const groupA = [unit([1, 0, 0, 0]), unit([0.95, 0.1, 0, 0]), unit([0.9, 0.2, 0, 0])];
const groupB = [unit([0, 0, 1, 0]), unit([0, 0.1, 0.95, 0]), unit([0, 0, 0.9, 0.2])];
const vectors = [...groupA, ...groupB];

function postsFrom(vs: ReadonlyArray<Float32Array>): AtlasPostInput[] {
  return vs.map((embedding, i) => ({
    address: `p:${i}` as RecordAddress,
    author: 'me' as PeerId,
    text: `post ${i}`,
    embedding,
    isOwn: true,
  }));
}

function stubLlm(
  complete: (prompt: string, o: LlmGenerateOptions) => Promise<string>,
): ILlmService {
  return {
    initialize: async () => {},
    shutdown: async () => {},
    complete,
    completeStream: async () => {},
  };
}

// tsx transpiles to CJS, which forbids top-level await — run inside main().
async function main(): Promise<void> {
console.log('sphericalKMeans');

check('separates two clear groups (k=2)', () => {
  const res = sphericalKMeans(vectors, 2, 25, 1234);
  assert.equal(res.k, 2);
  // The three A vectors share one label, the three B vectors another.
  const a = new Set(res.assignments.slice(0, 3));
  const b = new Set(res.assignments.slice(3));
  assert.equal(a.size, 1);
  assert.equal(b.size, 1);
  assert.notEqual([...a][0], [...b][0]);
});

check('is deterministic for a fixed seed', () => {
  const r1 = sphericalKMeans(vectors, 2, 25, 1234);
  const r2 = sphericalKMeans(vectors, 2, 25, 1234);
  assert.deepEqual(r1.assignments, r2.assignments);
});

check('medoid of each cluster is one of its members', () => {
  const res = sphericalKMeans(vectors, 2, 25, 1234);
  for (let c = 0; c < res.k; c++) {
    const idx = res.medoidIndices[c];
    assert.equal(res.assignments[idx], c);
  }
});

console.log('computeTopicAtlas');

await checkAsync(
  'atlas places every post within [-1, 1] and keeps all points (PCA fallback)',
  async () => {
    const atlas = await computeTopicAtlas(postsFrom(vectors));
    assert.equal(atlas.points.length, vectors.length);
    for (const p of atlas.points) {
      assert.ok(Math.abs(p.x) <= 1.0001 && Math.abs(p.y) <= 1.0001);
    }
    assert.ok(atlas.k >= 1);
  },
);

await checkAsync('small-N atlas keeps the two groups spatially separated', async () => {
  // N = 6 < minPointsForUmap, so this exercises the deterministic PCA path.
  const atlas = await computeTopicAtlas(postsFrom(vectors));
  const byAddr = new Map(atlas.points.map((p) => [p.address, p]));
  const centroid = (idxs: number[]) => {
    let x = 0;
    let y = 0;
    for (const i of idxs) {
      const p = byAddr.get(`p:${i}` as RecordAddress)!;
      x += p.x;
      y += p.y;
    }
    return { x: x / idxs.length, y: y / idxs.length };
  };
  const ca = centroid([0, 1, 2]);
  const cb = centroid([3, 4, 5]);
  const between = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  // Within-group spread should be small relative to the gap between groups.
  const spreadA = Math.max(
    ...[0, 1, 2].map((i) => {
      const p = byAddr.get(`p:${i}` as RecordAddress)!;
      return Math.hypot(p.x - ca.x, p.y - ca.y);
    }),
  );
  assert.ok(between > spreadA, `groups not separated (gap=${between}, spread=${spreadA})`);
});

await checkAsync('large-N atlas (UMAP path) is bounded and deterministic', async () => {
  // 40 points across two tight clusters → exercises the UMAP branch.
  const big: Float32Array[] = [];
  for (let i = 0; i < 20; i++) big.push(unit([1, 0.02 * i, 0, 0]));
  for (let i = 0; i < 20; i++) big.push(unit([0, 0, 1, 0.02 * i]));
  const posts = postsFrom(big);
  const a1 = await computeTopicAtlas(posts);
  const a2 = await computeTopicAtlas(posts);
  assert.equal(a1.points.length, big.length);
  for (const p of a1.points) {
    assert.ok(Math.abs(p.x) <= 1.0001 && Math.abs(p.y) <= 1.0001);
  }
  // Same seed, same input → identical projection on this engine.
  assert.deepEqual(
    a1.points.map((p) => [p.address, p.x, p.y, p.topicId]),
    a2.points.map((p) => [p.address, p.x, p.y, p.topicId]),
  );
});

await checkAsync('each topic carries central texts for naming', async () => {
  const atlas = await computeTopicAtlas(postsFrom(vectors));
  for (const t of atlas.topics) {
    assert.ok(t.centralTexts.length >= 1);
    assert.ok(t.centralTexts.length <= 5);
  }
});

console.log('nameTopics');

await checkAsync('maps topic ids to cleaned LLM names', async () => {
  const llm = stubLlm(async () => '  "Trail running"  ');
  const names = await nameTopics(
    { llm },
    {
      clusters: [
        { topicId: 0, centralTexts: ['a'] },
        { topicId: 1, centralTexts: ['b'] },
      ],
    },
    { maxTokens: 16, temperature: 0, perTopicTimeoutMs: 1000 },
  );
  assert.equal(names.length, 2);
  assert.equal(names[0].name, 'Trail running'); // quotes + whitespace stripped
  assert.equal(names[0].topicId, 0);
});

await checkAsync('degrades gracefully when the LLM throws', async () => {
  const llm = stubLlm(async () => {
    throw new Error('model not loaded');
  });
  const names = await nameTopics(
    { llm },
    { clusters: [{ topicId: 0, centralTexts: ['a'] }] },
    { maxTokens: 16, temperature: 0, perTopicTimeoutMs: 1000 },
  );
  assert.deepEqual(names, []);
});

await checkAsync('drops topics that exceed the timeout', async () => {
  const llm = stubLlm(() => new Promise<string>(() => {})); // never resolves
  const names = await nameTopics(
    { llm },
    { clusters: [{ topicId: 0, centralTexts: ['a'] }] },
    { maxTokens: 16, temperature: 0, perTopicTimeoutMs: 10 },
  );
  assert.deepEqual(names, []);
});

console.log(`\n${passed} assertions passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
