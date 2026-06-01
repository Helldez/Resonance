#!/usr/bin/env tsx
/**
 * Unit tests for the semantic thread-echo gate (`isThreadEcho`). Self-contained
 * (tsx + node:assert), no DB/network. Vectors are hand-built and L2-normalised
 * so `cosineOnUnit` (a plain dot product) equals the cosine.
 */
import assert from 'node:assert/strict';
import { isThreadEcho } from '@core/agent/AgentMemory';

const v = (...xs: number[]): Float32Array => new Float32Array(xs);

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('isThreadEcho');

check('an identical reply is an echo', () => {
  assert.equal(isThreadEcho(v(1, 0), [v(1, 0)], 0.9), true);
});

check('an orthogonal reply is not an echo', () => {
  assert.equal(isThreadEcho(v(1, 0), [v(0, 1)], 0.9), false);
});

check('cosine exactly at the threshold counts as an echo (>=)', () => {
  // Exact-representable boundary: dot 1.0 against an identical unit vector at
  // threshold 1.0 → 1.0 >= 1.0. (Avoids float32 drift on fractional thresholds.)
  assert.equal(isThreadEcho(v(1, 0), [v(1, 0)], 1.0), true);
});

check('clearly below the threshold is not an echo', () => {
  // dot ~0.71 against [1,0], threshold 0.9 → not an echo.
  const near = v(Math.SQRT1_2, Math.SQRT1_2);
  assert.equal(isThreadEcho(v(1, 0), [near], 0.9), false);
});

check('takes the MAX over the thread (one match is enough)', () => {
  assert.equal(isThreadEcho(v(1, 0), [v(0, 1), v(1, 0)], 0.9), true);
});

check('an empty thread is never an echo (first reply)', () => {
  assert.equal(isThreadEcho(v(1, 0), [], 0.9), false);
});

check('a wrong-dimension entry is skipped, never throws', () => {
  // The dim-3 vector would throw in cosineOnUnit; isThreadEcho must swallow it
  // and still evaluate the valid entry (here: no echo).
  assert.equal(isThreadEcho(v(1, 0), [v(0, 1, 0), v(0, 1)], 0.9), false);
});

console.log(`\n${passed} assertions passed.`);
