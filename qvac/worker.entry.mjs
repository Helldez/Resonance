/**
 * Bare worklet entry — the host of all P2P + on-device AI in Resonance.
 *
 * Responsibilities:
 *   1. Load QVAC embedding and LLM plugins (declared in qvac.config.json).
 *   2. Open a Corestore at StorageConfig.corestoreDir, expose the user's
 *      personal Hypercore feed.
 *   3. Run Hyperswarm; join/leave bucket topics; replicate matching peer
 *      feeds.
 *   4. Cryptography (Ed25519 keypair, SHA-256 digests) via bare-crypto.
 *   5. Expose a JSON-RPC surface to the RN side via `bare-rpc` over the
 *      `react-native-bare-kit` worklet channel.
 *
 * This file is the SINGLE owner of all stateful P2P/AI handles. The RN
 * adapters in src/platform/mobile are thin clients that call into here.
 *
 * Wiring is staged across milestones — see docs/ROADMAP.md.
 */

import RPC from 'bare-rpc';
import { IPC } from 'pear-pipe';

const rpc = new RPC(IPC, (req) => {
  switch (req.command) {
    case 'ping':
      req.reply('pong');
      return;
    case 'load-embedding-model':
      // TODO M1: load EmbeddingGemma via QVAC plugin
      req.reply({ status: 'not-implemented', milestone: 'M1' });
      return;
    case 'load-llm':
      // TODO M2: load Qwen3-4B via QVAC plugin
      req.reply({ status: 'not-implemented', milestone: 'M2' });
      return;
    case 'embed':
      // TODO M2: text -> 768-dim float32, truncate to 256, L2-normalise
      req.reply({ status: 'not-implemented', milestone: 'M2' });
      return;
    case 'complete':
      // TODO M2: prompt -> LLM completion
      req.reply({ status: 'not-implemented', milestone: 'M2' });
      return;
    case 'identity-load-or-create':
      // TODO M1: open Corestore, derive Ed25519 keypair, persist
      req.reply({ status: 'not-implemented', milestone: 'M1' });
      return;
    case 'sign':
      // TODO M1: Ed25519 sign payload
      req.reply({ status: 'not-implemented', milestone: 'M1' });
      return;
    case 'sha256':
      // TODO M1: SHA-256 over bytes via bare-crypto
      req.reply({ status: 'not-implemented', milestone: 'M1' });
      return;
    case 'mailbox-append':
      // TODO M2: append to personal Hypercore, return feed index
      req.reply({ status: 'not-implemented', milestone: 'M2' });
      return;
    case 'mailbox-ingest':
      // TODO M2: store a peer record locally (Hyperdrive/Hypercore-backed)
      req.reply({ status: 'not-implemented', milestone: 'M2' });
      return;
    case 'network-join-bucket':
      // TODO M3: swarm.join(sha256(NetworkConfig.topicPrefix + bucketId))
      req.reply({ status: 'not-implemented', milestone: 'M3' });
      return;
    case 'network-leave-bucket':
      // TODO M3
      req.reply({ status: 'not-implemented', milestone: 'M3' });
      return;
    case 'network-publish':
      // TODO M3: write to own Hypercore; replication does the rest
      req.reply({ status: 'not-implemented', milestone: 'M3' });
      return;
    default:
      req.reply({ status: 'unknown-command', command: req.command });
  }
});

export default rpc;
