#!/usr/bin/env node
/**
 * Milestone 0 — calibration entry point.
 *
 * This script is intentionally minimal scaffolding. It does NOT yet
 * embed anything: that requires picking an embedding source. See the
 * README in this folder for the procedure. The script is wired here so
 * that `npm run calibrate` works and so that the calibration loop has
 * a single, obvious place to live.
 *
 * Next steps inside this file:
 *   - Load `./corpus.jsonl` (one JSON record per line, `{id, text}`).
 *   - Pick an embedding source. Either:
 *       a) call the same Bare worklet RPC the app uses, or
 *       b) call a Node-side embedding model for an offline-first check.
 *   - L2-normalise the vectors and truncate to MATCHING_DIM.
 *   - For each post, compute top-K neighbours by dot product and write
 *     `./out/nearest-<id>.md`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = resolve(__dirname, 'corpus.jsonl');
const OUT_DIR = resolve(__dirname, 'out');

const MATCHING_DIM = 256;
const TOP_K = 10;

async function main() {
  if (!existsSync(CORPUS_PATH)) {
    console.error(
      `corpus.jsonl not found at ${CORPUS_PATH}\n` +
        'Create it as one JSON object per line: {"id":"...","text":"..."}',
    );
    process.exit(1);
  }

  const raw = await readFile(CORPUS_PATH, 'utf8');
  const rows = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => JSON.parse(s));

  console.log(`Loaded ${rows.length} posts. MATCHING_DIM=${MATCHING_DIM}, TOP_K=${TOP_K}.`);

  // TODO M0: actually embed and write top-K reports.
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUT_DIR, 'TODO.md'),
    'Calibration scaffolding is in place. Wire an embedding source per the README.\n',
  );
  console.log(`Wrote placeholder at ${OUT_DIR}/TODO.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
