#!/usr/bin/env tsx
/**
 * Headless desktop peer.
 *
 * Boots the desktop container (same ports as mobile, different concrete
 * adapters), joins the single shared Resonance room via the Bare
 * subprocess, and exposes a tiny REPL so the operator can:
 *
 *   publish <text>     Author and publish a post (embed → sign → append).
 *   room               Show the single-room join status.
 *   exit               Shut down cleanly.
 *
 * Incoming records are verified (Ed25519), printed to the console, and
 * persisted in the SQLite projection so a follow-up Electron renderer can
 * read them without re-fetching. This script intentionally has zero UI
 * dependencies — it is the proof-of-life that the desktop platform layer
 * is correct end-to-end and can serve as the second device for testing
 * P2P matching against an Android peer.
 */

import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { DesktopConfig } from '@core/config/DesktopConfig';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { bootstrapDesktop, defaultAppDataDir } from '@platform/desktop/bootstrap';
import { createPost } from '@core/posts/CreatePost';
import { canonicalDigest } from '@core/utils/CanonicalRecord';
import { addressOf } from '@core/utils/AddressOf';
import type { SignedRecord } from '@core/domain/types';

async function main(): Promise<void> {
  const appDataDir = defaultAppDataDir(homedir(), process.platform);
  const entryPath = resolveBareEntry();

  if (!existsSync(entryPath)) {
    console.error(`[peer] Bare desktop entry not found at ${entryPath}.`);
    process.exit(1);
  }

  console.log(`[peer] app data dir: ${appDataDir}`);
  console.log(`[peer] bare entry:   ${entryPath}`);

  const container = await bootstrapDesktop({
    appDataDir,
    bareEntryPath: entryPath,
  });

  console.log(`[peer] self peerId: ${container.self}`);
  console.log(
    `[peer] outbox key: ${container.p2p.isReady ? '(ready)' : '(pending)'}, ` +
      `noise key: ${container.p2p.localNoiseKey ?? '(pending)'}`,
  );

  // Verify + persist every record that arrives over the network. This is the
  // same pipeline the mobile UI runs (CreatePost / ScoreIncomingPost), kept
  // here in CLI form so the desktop peer is a valid Resonance node from
  // the moment it boots.
  container.network.onRecord((record) => {
    void onIncoming(container, record);
  });
  container.network.onPeerPresence((peer, present) => {
    console.log(`[peer] presence: peer=${peer.slice(0, 12)} present=${present}`);
  });

  // Single-room model: join the one shared room so we both publish into and
  // receive from the global gossip fabric.
  await container.network.joinRoom();
  console.log('[peer] joined single room');

  startRepl(container);
}

async function onIncoming(
  container: Awaited<ReturnType<typeof bootstrapDesktop>>,
  record: SignedRecord,
): Promise<void> {
  const digest = await canonicalDigest(record.body);
  const ok = await container.identity.verify(digest, record.signature, record.author);
  if (!ok) {
    console.warn(
      `[peer] dropped invalid record from ${record.author.slice(0, 12)} idx=${record.feedIndex}`,
    );
    return;
  }
  if (record.body.kind === 'post') {
    const post = record.body;
    const address = addressOf(record.author, record.feedIndex);
    await container.posts.upsert(address, record.author, record.feedIndex, post, null);
    console.log(
      `[peer] post  ${address.slice(0, 18)}  "${post.text.slice(0, 80)}"`,
    );
    return;
  }
  if (record.body.kind === 'reaction') {
    const reaction = record.body;
    await container.reactions.applyFromRecord(
      addressOf(record.author, record.feedIndex),
      record.author,
      record.feedIndex,
      reaction,
    );
    console.log(
      `[peer] react ${record.author.slice(0, 12)}  → ${reaction.inReplyTo.slice(0, 18)}  ${reaction.reaction}`,
    );
    return;
  }
  const resp = record.body;
  await container.responses.upsert(
    addressOf(record.author, record.feedIndex),
    record.author,
    record.feedIndex,
    resp,
  );
  console.log(
    `[peer] reply ${record.author.slice(0, 12)}  → ${resp.inReplyTo.slice(0, 18)}  "${resp.text.slice(0, 80)}"`,
  );
}

function startRepl(
  container: Awaited<ReturnType<typeof bootstrapDesktop>>,
): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (): void => {
    rl.setPrompt('resonance> ');
    rl.prompt();
  };
  console.log('[peer] REPL: publish <text> | room | exit');
  prompt();

  rl.on('line', (raw) => {
    const line = raw.trim();
    void handleCommand(container, line).then(prompt).catch((err) => {
      console.error('[peer] command failed:', err);
      prompt();
    });
  });

  rl.on('close', () => {
    void shutdown(container);
  });
}

async function handleCommand(
  container: Awaited<ReturnType<typeof bootstrapDesktop>>,
  line: string,
): Promise<void> {
  if (line.length === 0) {
    return;
  }
  const spaceAt = line.indexOf(' ');
  const cmd = spaceAt < 0 ? line : line.slice(0, spaceAt);
  const arg = spaceAt < 0 ? '' : line.slice(spaceAt + 1).trim();

  switch (cmd) {
    case 'publish': {
      if (arg.length === 0) {
        console.log('usage: publish <text>');
        return;
      }
      const { record } = await createPost(
        {
          embedder: container.embedder,
          mailbox: container.mailbox,
          network: container.network,
          identity: container.identity,
          clock: container.clock,
          self: container.self,
        },
        { text: arg },
      );
      if (record.body.kind === 'post') {
        console.log(
          `[peer] published feedIndex=${record.feedIndex} dim=${MatchingConfig.embeddingDim}`,
        );
      }
      return;
    }
    case 'room': {
      console.log(
        `[peer] single room — outbox ${container.p2p.isReady ? 'ready' : 'pending'}, noise=${container.p2p.localNoiseKey?.slice(0, 12) ?? '(pending)'}`,
      );
      return;
    }
    case 'exit':
    case 'quit': {
      await shutdown(container);
      return;
    }
    default:
      console.log(`unknown command: ${cmd}`);
  }
}

async function shutdown(
  container: Awaited<ReturnType<typeof bootstrapDesktop>>,
): Promise<void> {
  console.log('[peer] shutting down…');
  try {
    await container.network.shutdown();
    await container.mailbox.shutdown();
    await container.p2p.shutdown();
    await container.embedder.shutdown();
    await container.llm.shutdown();
    await container.database.shutdown();
  } catch (err) {
    console.warn('[peer] shutdown error:', err);
  }
  process.exit(0);
}

function resolveBareEntry(): string {
  const here = fileURLToPath(import.meta.url);
  const repoRoot = resolve(here, '..', '..', '..');
  return resolve(repoRoot, DesktopConfig.bareDesktopEntry);
}

main().catch((err) => {
  console.error('[peer] fatal:', err);
  process.exit(1);
});
