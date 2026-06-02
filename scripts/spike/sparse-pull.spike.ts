#!/usr/bin/env tsx
/**
 * SPIKE A — validate the keystone of the announce-then-pull redesign:
 * "open a peer's outbox core but download ONLY the one block we admit, not the
 * whole feed". The entire Fase 1 design hinges on this Hypercore sparse-pull
 * semantic, so we de-risk it before touching the P2P worker.
 *
 * This is an in-process, deterministic check (no DHT): two Corestores are wired
 * together over a replication stream pair. The reader opens the author's core by
 * key and pulls a SINGLE block by index, then we assert that only that block was
 * downloaded — proving "decide first, download later" is real, not wishful.
 *
 * A separate, network-level relay test (non-adjacent holder over Hyperswarm +
 * swarm.join(discoveryKey) + findingPeers) is the follow-up; this script
 * validates the foundational sparse semantic that everything else assumes.
 *
 * Run: npx tsx scripts/spike/sparse-pull.spike.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import Corestore from 'corestore';
import b4a from 'b4a';

const N_BLOCKS = 8;
const PULL_INDEX = 5;

async function main(): Promise<void> {
  const dirA = mkdtempSync(join(tmpdir(), 'spikeA-author-'));
  const dirB = mkdtempSync(join(tmpdir(), 'spikeA-reader-'));
  let storeA: InstanceType<typeof Corestore> | null = null;
  let storeB: InstanceType<typeof Corestore> | null = null;

  try {
    // --- Author: build an outbox feed of N signed-ish blocks ---
    storeA = new Corestore(dirA);
    const coreA = storeA.get({ name: 'outbox' });
    await coreA.ready();
    for (let i = 0; i < N_BLOCKS; i++) {
      await coreA.append(b4a.from(`block-${i}`, 'utf8'));
    }
    console.log(`[spikeA] author outbox ready: key=${b4a.toString(coreA.key, 'hex').slice(0, 12)} length=${coreA.length}`);

    // --- Reader: open the SAME core by key, in a fresh store (nothing local yet) ---
    storeB = new Corestore(dirB);
    const coreB = storeB.get({ key: coreA.key });
    await coreB.ready();

    // --- Wire replication between the two stores (stands in for a P2P link) ---
    const sA = storeA.replicate(true);
    const sB = storeB.replicate(false);
    sA.pipe(sB).pipe(sA);
    sA.on('error', () => {});
    sB.on('error', () => {});

    // Learn the feed length/merkle WITHOUT downloading block data.
    await coreB.update({ wait: true });
    console.log(`[spikeA] reader sees length=${coreB.length} (no blocks pulled yet)`);
    assert.equal(coreB.length, N_BLOCKS, 'reader should learn the full length via merkle, no data');

    // Snapshot availability before the pull — should be empty.
    const beforeHave: boolean[] = [];
    for (let i = 0; i < N_BLOCKS; i++) beforeHave.push(await coreB.has(i));
    assert.ok(beforeHave.every((h) => h === false), 'reader must hold NO blocks before pulling');

    // --- The keystone: pull EXACTLY one block by index ---
    const t0 = Date.now();
    const block = await coreB.get(PULL_INDEX, { wait: true, timeout: 8000 });
    const dt = Date.now() - t0;
    assert.equal(b4a.toString(block, 'utf8'), `block-${PULL_INDEX}`, 'pulled block content must match');
    console.log(`[spikeA] pulled block #${PULL_INDEX} = "${b4a.toString(block, 'utf8')}" in ${dt}ms`);

    // --- Prove sparseness: ONLY the requested block was downloaded ---
    const afterHave: boolean[] = [];
    for (let i = 0; i < N_BLOCKS; i++) afterHave.push(await coreB.has(i));
    const downloaded = afterHave.filter((h) => h).length;
    console.log(`[spikeA] blocks held by reader after pull: ${afterHave.map((h, i) => (h ? i : '·')).join(' ')}`);
    assert.equal(afterHave[PULL_INDEX], true, 'requested block must be present');
    assert.equal(downloaded, 1, 'EXACTLY one block must have been downloaded (sparse)');

    console.log(`\n[spikeA] PASS — sparse single-block pull works: ${downloaded}/${N_BLOCKS} blocks downloaded.`);
    console.log('[spikeA] Keystone validated: a peer can rank on summaries and pull only what it admits.');
  } finally {
    // Close stores before removing temp dirs — on Windows open handles block rm.
    try { if (storeB !== null) await storeB.close(); } catch { /* best-effort */ }
    try { if (storeA !== null) await storeA.close(); } catch { /* best-effort */ }
    try { rmSync(dirA, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { rmSync(dirB, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[spikeA] FAIL:', err);
    process.exit(1);
  },
);
