# Resonance — Architecture

## One-line description

Local-first P2P social network. Posts are routed between peers by semantic
similarity over locally-computed embeddings, and answered by on-device
LLMs.

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
`MatchingConfig.embeddingDim` (= 256), L2-normalised. It is produced by
EmbeddingGemma running in the Bare worklet (QVAC `llamacpp-embedding`
plugin). The 768→256 truncation uses EmbeddingGemma's Matryoshka head.

### LLM
`ILlmService.complete(prompt, options)` returns generated text from
Qwen 3 4B Instruct (Q4_K_M), also via QVAC in the worklet.

Both are abstracted behind ports so the calibration script can swap a
Node-side embedding model in for offline analysis.

## The semantic routing pipeline

```
text ──embed──▶ Float32Array (256-dim, unit norm)
                       │
                       ├──▶ LshBucket(seed, bits) ──▶ BucketId
                       │                                  │
                       │                                  ▼
                       │                       sha256(topicPrefix||bucketId)
                       │                                  │
                       │                                  ▼
                       │                       Hyperswarm.join(topic)
                       │
                       └──▶ signed PostBody ──▶ own Hypercore feed
                                            ──▶ replication to peers in bucket
```

On the receiver:

```
incoming SignedRecord
         │
         ├──▶ Mailbox.ingest()    (durable append-only)
         │
         └──▶ ScoreIncomingPost(record, interestProfile)
                       │
                       ├─ similarity < threshold ─▶ drop
                       │
                       └─ similarity ≥ threshold ─▶ Inbox
```

The receiver's `interestProfile` is its own L2-normalised vector,
computed from the user-supplied "About you" string (M2) and later from
the centroid of their past posts and explicit topic prefs.

## Identity & signing

- Ed25519 keypair generated on first launch inside the Bare worklet, via
  `bare-crypto`. Public key is the `PeerId` everywhere.
- Each record carries `digest = sha256(canonicalBytes(body))` and
  `signature = ed25519_sign(privateKey, digest)`.
- The canonical serialiser lives in `src/core/utils/CanonicalRecord.ts`;
  the actual SHA-256 implementation is injected from the worklet.
- The keypair is persisted via `IKeyValueStore` (AsyncStorage in mobile).

## What lives where

- All tunables: `src/core/config/`.
- All cross-cutting "shape" definitions: `src/core/domain/types.ts`.
- All ports: `src/core/ports/`.
- All matching maths (LSH, cosine, L2): `src/core/matching/`.
- All use cases: `src/core/{posts,responses,identity,net}/`.
- All Expo/RN/Bare code: `src/platform/mobile/` + `qvac/worker.entry.mjs`.

## Semantic routing

The "how does a post reach the right peers without a central server"
question — including the cliff problem with single-bucket LSH, the
multi-table / Hamming-1 / gossip-top-K / Semantica tiers we have
discussed, and the volume scenarios that gate each tier — lives in
`docs/SEMANTIC_ROUTING.md`. That doc is the source of truth for the
scaling hypotheses; the implementation in this folder is its Tier 1.

## What is NOT in the MVP

See `docs/ROADMAP.md` for the explicit out-of-scope list. The short
version: no push relay, no auto-publish mode activated, no fuzzy PSI,
no multi-perspective synthesis, no iOS, no reputation, no web-of-trust.
(The Android foreground service that keeps the Bare worker alive in
background *is* now part of the MVP; see `docs/STATUS.md`.)
