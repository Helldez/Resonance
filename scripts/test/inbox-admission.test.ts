#!/usr/bin/env tsx
/**
 * Unit tests for the bounded top-K inbox admission rule (conf 9). No test
 * framework is wired in the MVP, so this is a self-contained script run via
 * `npm test` (tsx + node:assert). It exercises the pure decision function in
 * isolation — no DB, no network.
 */
import assert from 'node:assert/strict';
import { decideAdmission } from '@core/inbox/InboxAdmission';
import type { RecordAddress } from '@core/domain/types';

const config = { capacity: 3, minSimilarity: 0.3 };
const addr = (s: string): RecordAddress => s as RecordAddress;

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('decideAdmission');

check('rejects below the threshold', () => {
  const d = decideAdmission({
    similarity: 0.2,
    currentCount: 0,
    min: null,
    config,
  });
  assert.equal(d.kind, 'reject-threshold');
});

check('rejects an unscorable (null) post', () => {
  const d = decideAdmission({
    similarity: null,
    currentCount: 0,
    min: null,
    config,
  });
  assert.equal(d.kind, 'reject-threshold');
});

check('admits while under capacity', () => {
  const d = decideAdmission({
    similarity: 0.5,
    currentCount: 2,
    min: { address: addr('a:0'), similarity: 0.4 },
    config,
  });
  assert.equal(d.kind, 'admit');
});

check('admits exactly at the threshold boundary', () => {
  const d = decideAdmission({
    similarity: 0.3,
    currentCount: 0,
    min: null,
    config,
  });
  assert.equal(d.kind, 'admit');
});

check('replaces the weakest when full and newcomer scores higher', () => {
  const d = decideAdmission({
    similarity: 0.8,
    currentCount: 3,
    min: { address: addr('weak:1'), similarity: 0.5 },
    config,
  });
  assert.equal(d.kind, 'replace');
  assert.equal(d.kind === 'replace' ? d.evict : null, addr('weak:1'));
});

check('rejects when full and newcomer does not beat the weakest', () => {
  const d = decideAdmission({
    similarity: 0.5,
    currentCount: 3,
    min: { address: addr('weak:1'), similarity: 0.5 },
    config,
  });
  assert.equal(d.kind, 'reject-full'); // tie keeps the incumbent
});

console.log(`\n${passed} assertions passed.`);
