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
│  src/platform/mobile/   Concrete adapters (Expo, RN, Bare)   │
├──────────────────────────────────────────────────────────────┤
│  qvac/worker.entry.mjs  Bare worklet:                        │
│                         QVAC embedding/LLM + Hyperswarm      │
│                         + Hypercore + bare-crypto            │
└──────────────────────────────────────────────────────────────┘
```

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

## The single-room model (conf 9, "Keet model")

Resonance runs **one shared P2P room** — no semantic buckets, no DHT
routing table, no sticky peers. Every node joins a single Hyperswarm topic
derived as `sha256(RoomConfig.topicPrefix || RoomConfig.roomId)`, and peer
outbox keys gossip transitively (`bare/room-directory.mjs`) so every post
eventually reaches every peer in ~log₃₂(N) hops
(`RoomConfig.maxConnections = 32`).

```
text ──embed──▶ Float32Array (768-dim, unit norm)
                       │
                       ├──▶ signed PostBody ──▶ own Hypercore feed
                       │                     ──▶ replicated to the room
                       │
                       └──▶ directory gossip spreads the author's outbox key
```

Publishing is just embed → sign → append; there is no routing decision at
compose time. Source: `src/core/posts/CreatePost.ts`, `bare/p2p.mjs`,
`bare/room-directory.mjs`.

On the receiver, every replicated post is scored and filtered into a
**bounded top-K inbox**:

```
incoming SignedRecord
         │
         ├──▶ verify Ed25519 signature   (mismatch → dropped, never stored)
         │
         ├──▶ ScoreIncomingPost: similarity = MAX cosine vs own posts
         │      (cold start: cosine vs the "About you" embedding)
         │
         └──▶ decideAdmission (src/core/inbox/InboxAdmission.ts)
                  ├─ similarity < RoomConfig.inboxMinSimilarity ─▶ drop
                  ├─ under RoomConfig.inboxCapacity ─────────────▶ admit
                  └─ full ─▶ replace the weakest iff the newcomer scores higher
```

The inbox keeps at most `RoomConfig.inboxCapacity` (200) remote posts; own
posts and responses are stored separately and do not count against it. The
`similarity` is computed once at receive time and frozen in SQLite.

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
  (`bare/p2p.mjs`, `bare/room-directory.mjs`).

## Routing history

The current model is the single-room one above; `RoomConfig` is its source
of truth. The earlier LSH-bucket routing — the cliff problem with
single-bucket LSH, the multi-table / Hamming-1 / gossip-top-K / Semantica
tiers, and the volume scenarios that gated each — was dropped in conf 9 and
now lives, clearly marked historical, in `docs/SEMANTIC_ROUTING.md`. The
runtime publish/receive flow is detailed in `docs/MATCHING_FLOW.md` (whose
body is likewise the superseded LSH flow, with a current-model banner on
top).

## What is NOT in the MVP

See `docs/ROADMAP.md` for the explicit out-of-scope list. The short
version: no push relay, no auto-publish mode activated, no fuzzy PSI,
no multi-perspective synthesis, no iOS, no reputation, no web-of-trust.
(The Android foreground service that keeps the Bare worker alive in
background *is* now part of the MVP; see `docs/STATUS.md`.)
