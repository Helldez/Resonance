#!/usr/bin/env tsx
/**
 * Unit tests for the pure feed grouping (`@ui/feed/groupFeed`): own posts as
 * anchors, matched remotes nested (expanded only), unmatched remotes in the
 * trailing "Based on your interests" group. Self-contained (tsx +
 * node:assert), no React/DB.
 */
import assert from 'node:assert/strict';
import { groupFeed, type FeedRow } from '@ui/feed/groupFeed';

const SELF = 'self-peer';

function row(partial: Partial<FeedRow> & { address: string }): FeedRow {
  return {
    author: 'remote-peer',
    text: 'text',
    similarity: null,
    matchedOwnAddress: null,
    createdAt: 0,
    ...partial,
  };
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('groupFeed');

check('own post anchors its matched remotes; collapsed by default', () => {
  const own = row({ address: 'own:1', author: SELF });
  const child = row({ address: 'r:1', matchedOwnAddress: 'own:1', similarity: 0.8 });
  const items = groupFeed([own, child], SELF, new Set());
  assert.deepEqual(
    items.map((i) => i.kind),
    ['own'],
  );
  assert.ok(items[0].kind === 'own' && items[0].childCount === 1);
});

check('expanded anchor emits children most-similar first', () => {
  const own = row({ address: 'own:1', author: SELF });
  const weak = row({ address: 'r:1', matchedOwnAddress: 'own:1', similarity: 0.5 });
  const strong = row({ address: 'r:2', matchedOwnAddress: 'own:1', similarity: 0.9 });
  const items = groupFeed([own, weak, strong], SELF, new Set(['own:1']));
  assert.deepEqual(
    items.map((i) => (i.kind === 'orphan-header' ? i.kind : `${i.kind}:${i.row.address}`)),
    ['own:own:1', 'child:r:2', 'child:r:1'],
  );
});

check('cold start: remotes with no own match become orphans under one header', () => {
  const a = row({ address: 'r:1', similarity: 0.7 });
  const b = row({ address: 'r:2', similarity: 0.9 });
  const items = groupFeed([a, b], SELF, new Set());
  assert.deepEqual(
    items.map((i) => (i.kind === 'orphan-header' ? i.kind : `${i.kind}:${i.row.address}`)),
    ['orphan-header', 'orphan:r:2', 'orphan:r:1'],
  );
  assert.ok(items[0].kind === 'orphan-header' && items[0].count === 2);
});

check('a match to an own post not in view falls back to the orphan group', () => {
  const child = row({ address: 'r:1', matchedOwnAddress: 'own:gone', similarity: 0.8 });
  const items = groupFeed([child], SELF, new Set());
  assert.deepEqual(items.map((i) => i.kind), ['orphan-header', 'orphan']);
});

check('own posts keep their query order; null similarity sorts last among children', () => {
  const own1 = row({ address: 'own:1', author: SELF, createdAt: 2 });
  const own2 = row({ address: 'own:2', author: SELF, createdAt: 1 });
  const scored = row({ address: 'r:1', matchedOwnAddress: 'own:2', similarity: 0.4 });
  const unscored = row({ address: 'r:2', matchedOwnAddress: 'own:2', similarity: null });
  const items = groupFeed([own1, own2, scored, unscored], SELF, new Set(['own:2']));
  assert.deepEqual(
    items.map((i) => (i.kind === 'orphan-header' ? i.kind : `${i.kind}:${i.row.address}`)),
    ['own:own:1', 'own:own:2', 'child:r:1', 'child:r:2'],
  );
});

check('empty input produces an empty feed (no orphan header)', () => {
  assert.deepEqual(groupFeed([], SELF, new Set()), []);
});

console.log(`\n${passed} assertions passed.`);
