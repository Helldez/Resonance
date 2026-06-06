#!/usr/bin/env tsx
/**
 * Unit tests for the agent action registry (schemas + validators) and the
 * persona KV-cache key. Self-contained (tsx + node:assert), no DB/LLM.
 */
import assert from 'node:assert/strict';
import { CommentAction, PostAction } from '@core/agent/AgentActions';
import { AgentConfig } from '@core/config/AgentConfig';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const REAL_TEXT = 'this is a real, substantive reply with actual content';

console.log('CommentAction');

check('valid payload trims and keeps text + rationale', () => {
  const r = CommentAction.validate({ text: `  ${REAL_TEXT}  `, rationale: 'because' });
  assert.deepEqual(r, { text: REAL_TEXT, rationale: 'because' });
});
check('empty/whitespace text → null', () => {
  assert.equal(CommentAction.validate({ text: '   ' }), null);
});
check('missing text → null', () => {
  assert.equal(CommentAction.validate({ rationale: 'x' }), null);
});
check('non-object → null', () => {
  assert.equal(CommentAction.validate('nope'), null);
});
check('rationale clamps to 120 chars', () => {
  const r = CommentAction.validate({ text: REAL_TEXT, rationale: 'a'.repeat(200) });
  assert.equal(r?.rationale.length, 120);
});
check('schema encodes additionalProperties:false + required text + maxLength', () => {
  assert.equal(CommentAction.schema.additionalProperties, false);
  assert.deepEqual(CommentAction.schema.required, ['text']);
  assert.equal(CommentAction.schema.properties.text.maxLength, 240);
});

console.log('CommentAction — degenerate-draft guard');

check('the literal schema echo "text" → null (observed live)', () => {
  assert.equal(CommentAction.validate({ text: 'text' }), null);
});
check('placeholder echo is case-insensitive', () => {
  assert.equal(CommentAction.validate({ text: 'TEXT' }), null);
});
check('a fragment below minDraftChars → null', () => {
  const tooShort = 'x'.repeat(AgentConfig.draftQuality.minDraftChars - 1);
  assert.equal(CommentAction.validate({ text: tooShort }), null);
});
check('a draft exactly at minDraftChars passes', () => {
  const atFloor = 'y'.repeat(AgentConfig.draftQuality.minDraftChars);
  assert.equal(CommentAction.validate({ text: atFloor })?.text, atFloor);
});

console.log('PostAction');

check('valid post clamps to 280', () => {
  const r = PostAction.validate({ text: 'x'.repeat(400) });
  assert.equal(r?.text.length, 280);
});
check('empty post → null', () => {
  assert.equal(PostAction.validate({ text: '' }), null);
});
check('placeholder echo "text" → null', () => {
  assert.equal(PostAction.validate({ text: 'text' }), null);
});
check('schema required text + maxLength 280', () => {
  assert.deepEqual(PostAction.schema.required, ['text']);
  assert.equal(PostAction.schema.properties.text.maxLength, 280);
});

console.log(`\n${passed} assertions passed.`);
