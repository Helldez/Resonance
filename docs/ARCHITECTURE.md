# Resonance — Architecture

## One-line description

Local-first P2P social network. Every node joins one shared room; posts are
broadcast to it and surfaced by semantic similarity over locally-computed
embeddings, then answered by on-device LLMs.

## Layered view

```
┌──────────────────────────────────────────────────────────────┐
│  src/app/      Expo screens (UI)                             │
├──────────────────────────────────────────────────────────────┤
│  src/domain/   Zustand stores + UI types                     │
├──────────────────────────────────────────────────────────────┤
│  src/core/     Pure TypeScript — domain, use cases, matching │
│                Depends ONLY on @core/ports/*                 │
├──────────────────────────────────────────────────────────────┤
│  src/data/     SQLite-backed projection repositories         │
├──────────────────────────────────────────────────────────────┤
│  src/platform/shared/   Target-agnostic adapter layer:       │
│                         P2pWorker + P2pMailbox + P2pNetwork, │
│                         FramedRpcClient, WireCodec           │
├──────────────────────────────────────────────────────────────┤
│  src/platform/mobile/   Expo/RN adapters + WorkletTransport  │
│  src/platform/desktop/  Node/Electron adapters +             │
│                         SubprocessTransport                  │
├──────────────────────────────────────────────────────────────┤
│  qvac/worker.entry.mjs  Bare worklet:                        │
│                         QVAC embedding/LLM + Hyperswarm      │
│                         + Hypercore + bare-crypto            │
└──────────────────────────────────────────────────────────────┘
```

`src/platform/shared/` is the seam that makes the desktop peer cheap: the
whole P2P adapter stack (worker lifecycle, RPC framing, record wire codec)
is written once against an injected `RpcTransport`; mobile supplies a Bare
worklet channel, desktop a loopback-TCP channel to a Bare subprocess. See
`docs/DESKTOP.md` for the per-port adapter matrix.

Arrows point downward only. `src/core/**` must never import anything from
`src/platform/`, RN, Expo, Bare, or Node. It only imports from
`@core/ports/*`. Violations break the test harness because the core is
intended to be runnable in plain Node for `npm run calibrate`.

## The two AI surfaces

### Embeddings
`IEmbeddingService.embed(text)` returns a `Float32Array` of length
`MatchingConfig.embeddingDim` (= 768), L2-normalised. It is produced by
EmbeddingGemma-300M running in the Bare worklet (QVAC `llamacpp-embedding`
plugin), using the full 768-dim output with the `task: clustering | query:
{text}` prompt template (`ModelProfiles.embedding.promptTemplate`).

### LLM
`ILlmService.complete(prompt, options)` returns generated text from
Qwen3-1.7B (Q4_0), also via QVAC in the worklet (`ModelProfiles.llm`).

Both are abstracted behind ports so the calibration script can swap a
Node-side embedding model in for offline analysis.

## The single-room model — announce-then-pull (v6)

Resonance runs **one shared P2P room** — no semantic buckets, no DHT
routing table, no sticky peers. Every node joins a single Hyperswarm topic
derived as `sha256(RoomConfig.topicPrefix || RoomConfig.roomId)`. Unsigned
**announcements** (author + outbox key + embedding + digest of the signed
record) gossip transitively over the `resonance-announce/v2` channel
(`bare/announce-directory.mjs`; compact-encoding binary via
`bare/announce-codec.mjs`, batched at `RoomConfig.announceBatchSize` per
message so the on-open snapshot never exceeds the transport's frame cap) so
every announcement reaches every peer in ~log₃₂(N) hops
(`RoomConfig.maxConnections = 32`). Record **bodies are not replicated
wholesale**: a peer sparse-downloads exactly the blocks it admits.

```
text ──embed──▶ Float32Array (768-dim, unit norm)
                       │
                       ├──▶ signed PostBody ──▶ own Hypercore feed (outbox)
                       │
                       └──▶ ANNOUNCEMENT {author, embedding, digest}
                            gossiped to the room (re-announced on boot)
```

Publishing is just embed → sign → append → announce; there is no routing
decision at compose time. Source: `src/core/posts/CreatePost.ts`,
`bare/p2p.mjs`, `bare/announce-directory.mjs`.

On the receiver, ingestion is **two-tier** — rank the cheap summary first,
download only the winners:

```
incoming ANNOUNCEMENT (unverified embedding — cheap)
         │
         ├──▶ scoreAgainstOwn: similarity = MAX cosine vs own posts
         │      (cold start: cosine vs the "About you" embedding)
         │
         ├──▶ Tier-1 summary store (`announcements` table,
         │      cap RoomConfig.announceTier1Capacity, for re-ranking)
         │
         └──▶ decideAdmission (src/core/inbox/InboxAdmission.ts)
                  ├─ similarity < RoomConfig.inboxMinSimilarity ─▶ no pull
                  ├─ under RoomConfig.inboxCapacity ─────────────▶ PULL
                  └─ full ─▶ PULL iff the newcomer beats the weakest

PULL → sparse-download that ONE block from the author's outbox
         │
         ├──▶ input bounds (ValidateRecordBody) + canonical digest check
         ├──▶ verify Ed25519 signature   (mismatch → dropped, never stored)
         └──▶ RE-SCORE on the verified embedding → commit to the Tier-2
              inbox (or drop — a lying announcement dies here)
```

The Tier-2 inbox keeps at most `RoomConfig.inboxCapacity` (200) remote
posts; own posts and responses are stored separately and do not count
against it. Download, signature verification and body storage are paid only
for that bounded set; the announcement stream is the only O(N) cost.

## Identity & signing

- Ed25519 keypair generated on first launch inside the Bare worklet, via
  `bare-crypto`. Public key is the `PeerId` everywhere.
- Each record carries `digest = sha256(canonicalBytes(body))` and
  `signature = ed25519_sign(privateKey, digest)`.
- The canonical serialiser lives in `src/core/utils/CanonicalRecord.ts`;
  the actual SHA-256 implementation is injected from the worklet.
- The keypair is persisted via `IKeyValueStore` (AsyncStorage in mobile).

## What lives where

- All tunables: `src/core/config/` (`RoomConfig` for the single-room model,
  `MatchingConfig` for scoring, `TopicConfig` for the atlas).
- All cross-cutting "shape" definitions: `src/core/domain/types.ts`.
- All ports: `src/core/ports/`.
- All vector maths (cosine, L2, 2-D projection): `src/core/matching/`.
- Inbox admission and topic clustering: `src/core/{inbox,topics}/`.
- All use cases: `src/core/{posts,responses,identity,net}/`.
- All Expo/RN/Bare code: `src/platform/mobile/` + the Bare worker
  (`bare/p2p.mjs`, `bare/announce-directory.mjs`).

## Routing history

The current model is the announce-then-pull single room above; `RoomConfig`
is its source of truth. Earlier topologies — the LSH-bucket routing (v1–v2,
with the single-bucket cliff problem and the multi-table / Hamming-1 /
gossip-top-K tiers) and the replicate-every-core single room (v3–v4) — are
preserved, clearly marked historical, in `docs/SEMANTIC_ROUTING.md`. The
current runtime publish/gossip/pull flow is detailed step-by-step in
`docs/MATCHING_FLOW.md`.

## What is NOT in the MVP

See `docs/ROADMAP.md` for the explicit out-of-scope list. The short
version: no push relay, no auto-publish mode activated, no fuzzy PSI,
no multi-perspective synthesis, no iOS, no reputation, no web-of-trust.
(The Android foreground service that keeps the Bare worker alive in
background *is* now part of the MVP; see `docs/STATUS.md`.)
