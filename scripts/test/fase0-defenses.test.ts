#!/usr/bin/env tsx
/**
 * Unit tests for the Phase-0 defensive guards: untrusted-input validation
 * (`validateRecordBody`) and the LLM-prompt sanitiser (`sanitizeUntrusted`).
 * Same self-contained style as the other tests — tsx + node:assert, no DB,
 * no network. Run via `npm test`.
 */
import assert from 'node:assert/strict';
import { validateRecordBody } from '@core/validation/ValidateRecordBody';
import { sanitizeUntrusted } from '@core/agent/SanitizeUntrusted';
import type { PostBody, ResponseBody, ReactionBody, RecordAddress } from '@core/domain/types';

const limits = { maxPostChars: 100, maxResponseChars: 50, embeddingDim: 4 };
const addr = (s: string): RecordAddress => s as RecordAddress;

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const post = (text: string, dim: number): PostBody => ({
  kind: 'post',
  text,
  embedding: new Float32Array(dim),
  createdAt: 0,
});
const response = (text: string): ResponseBody => ({
  kind: 'response',
  text,
  inReplyTo: addr('a:0'),
  createdAt: 0,
});
const reaction = (): ReactionBody => ({
  kind: 'reaction',
  inReplyTo: addr('a:0'),
  reaction: 'like',
  createdAt: 0,
});

console.log('validateRecordBody');

check('accepts a well-formed post', () => {
  assert.equal(validateRecordBody(post('hello', 4), limits).ok, true);
});

check('rejects an over-long post', () => {
  const r = validateRecordBody(post('x'.repeat(101), 4), limits);
  assert.equal(r.ok, false);
});

check('rejects a wrong-dimension embedding', () => {
  const r = validateRecordBody(post('ok', 8), limits);
  assert.equal(r.ok, false);
});

check('accepts a post exactly at the char boundary', () => {
  assert.equal(validateRecordBody(post('x'.repeat(100), 4), limits).ok, true);
});

check('rejects an over-long response', () => {
  const r = validateRecordBody(response('x'.repeat(51)), limits);
  assert.equal(r.ok, false);
});

check('accepts a reaction unconditionally (no free-form text)', () => {
  assert.equal(validateRecordBody(reaction(), limits).ok, true);
});

console.log('sanitizeUntrusted');

check('strips http/https links', () => {
  assert.equal(sanitizeUntrusted('see http://evil.test now'), 'see [link removed] now');
  assert.equal(sanitizeUntrusted('https://EVIL.test'), '[link removed]');
});

check('strips www. links case-insensitively', () => {
  assert.equal(sanitizeUntrusted('go WWW.evil.test'), 'go [link removed]');
});

check('strips @handles', () => {
  assert.equal(sanitizeUntrusted('ping @attacker please'), 'ping [handle removed] please');
});

check('leaves a bare @ untouched', () => {
  assert.equal(sanitizeUntrusted('email a @ b'), 'email a @ b');
});

check('preserves ordinary prose (whitespace normalised)', () => {
  assert.equal(sanitizeUntrusted('  hello   world\n'), 'hello world');
});

check('handles empty text', () => {
  assert.equal(sanitizeUntrusted(''), '');
});

console.log(`\n${passed} assertions passed.`);
