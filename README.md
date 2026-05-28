# Resonance

**P2P AI Semantic Connection** — a decentralized peer-to-peer infrastructure
on which to build a decentralized network of on-device AI agents that meet
the needs of people, entities, and companies, by **semantic matching**
rather than by follow graph, advertising, or central index.

No server. No cloud. No accounts. Two devices that have something to say
to each other find each other through the meaning of what they wrote.

## The vision

The internet today connects you to whoever bought the ad slot next to your
search, whoever the algorithm decided to feed you, whoever happens to be
in your follower graph. None of that is "the person who could actually
help you".

Resonance bets on a simple, contrarian idea:

> If every device can run a useful AI model locally, and every device can
> reach every other device peer-to-peer, then the bottleneck is no longer
> compute or bandwidth — it is **routing by meaning**. A need finds the
> right respondent because their semantic profile lights up under the
> need's embedding, not because they paid to be there.

What lives on this infrastructure is up to whoever builds on it:

- A **person** writes a question or a thought; nearby AI agents from peers
  who actually know about it draft answers; the originator picks one or
  synthesises them.
- An **entity** (a research group, a community) operates an agent that
  speaks for its corpus; people whose questions match its expertise reach
  it without going through Google.
- A **company** (B2B, support, sales) runs an agent that recognises the
  customers/leads whose stated needs match what it offers; the agent
  introduces itself only when the semantic match is strong, never as
  unsolicited spam.

The common substrate is the same: **on-device embeddings, on-device LLMs,
and a P2P routing layer that uses semantic distance as its address space**.

This repository is the first end-to-end implementation of that substrate
in the form of a working app (a "semantic social feed") that doubles as a
testbed for the routing layer.

## How it works, end-to-end

```
You write a post.
   │
   ▼
 EmbeddingGemma on-device → 256-dim semantic vector
   │
   ▼
 LSH bucket bits (8 hyperplanes × 8 independent tables)
   │
   ▼
 Hyperswarm joins 8 topics derived from those buckets
   │
   ▼
 Peers in any of the 8 buckets discover you, replicate your post
   │
   ▼
 Each peer scores the post against their own posts on-device
   │
   ▼
 If close enough, the post lands in their feed
   │
   ▼
 They tap "Write reply" (typed) or "Draft with AI" (Qwen 3 drafts it)
   │
   ▼
 Their reply comes back to you through the same P2P fabric
```

The semantic map screen lets you *see* this geometry: your post in the
middle, every nearby post placed at a radial distance equal to its cosine
similarity to yours, with the angular position carrying the PCA structure
of the local cluster.

## What's in this repository

A working Android app implementing the substrate, plus the
documentation of the design decisions behind it.

| Path | What it is |
|---|---|
| `src/core/` | Pure-TypeScript domain. Use cases, matching math, ports. Runs in plain Node too — that is how the calibration script in `scripts/calibration/` evaluates embedding quality without booting the app. |
| `src/data/` | SQLite-backed projection repositories (posts, responses, peers). |
| `src/platform/mobile/` | Concrete adapters for Expo / React Native / Bare. |
| `src/app/` | The Expo Router screens: Feed, Compose, semantic Map, Thread, Settings, Bootstrap. |
| `qvac/`, `bare/` | The Bare worklet that hosts the @qvac/sdk inference plugin and the Hyperswarm + Hypercore + Corestore stack. |
| `docs/ARCHITECTURE.md` | Layered view of the codebase, the hexagonal boundary, where the two AI surfaces (embedding + LLM) plug in. |
| `docs/SEMANTIC_ROUTING.md` | The why and how of the routing layer. Tiers 1 → 4, the cliff problem, sticky peers, `authorNoiseKey` direct-dial. This is the *thesis* document. |
| `docs/ROADMAP.md` | Milestones M0 → M5. |
| `docs/STATUS.md` | Implementation snapshot — what is wired vs. stubbed. |
| `SECURITY.md` | Audit of the on-device key material, threat model, Phase-2 hardening roadmap. |
| `AGENTS.md` | The non-negotiable rules for AI coding agents working on this repo. |

## Status

Pre-MVP, but functional end-to-end on two devices. The current build
demonstrates:

- ✅ Ed25519 identity, on-device key generation, signed records
- ✅ EmbeddingGemma 300M Q8 + Qwen 3 1.7B Q4 running locally via @qvac/sdk
- ✅ Hyperswarm/Hypercore P2P with multi-table LSH routing (Tier 2)
- ✅ Sticky peers (persistent direct DHT connections after first contact)
- ✅ Post-driven re-bucketing (your interest vector evolves with your posts)
- ✅ `authorNoiseKey` in every signed post (anyone with your post can dial
  you back directly, regardless of bucket drift)
- ✅ Android foreground service so the worker keeps replicating in the
  background
- ✅ Dark UI, semantic map with reference rings and PCA-angular layout

The Milestone 0 calibration (corpus-based threshold tuning) is the gate
before public release.

## Stack

- React Native + Expo (Android target for the MVP)
- Bare worklet hosting [@qvac/sdk](https://qvac.tether.io/dev/sdk/) for
  on-device embeddings and LLM, and Hyperswarm / Hypercore / Corestore
  for P2P
- Strict TypeScript, hexagonal architecture
- Embeddings: EmbeddingGemma 300M (Q8_0, 256-dim Matryoshka, L2-normalised)
- LLM: Qwen 3 1.7B Instruct (Q4_0)
- Identity: Ed25519 via `@noble/ed25519`
- DHT identity: Hyperswarm noise keypair (persisted across restarts —
  see `docs/SEMANTIC_ROUTING.md` §10)

## Build and run

USB-attached Android device, Node ≥ 20:

```powershell
npm install --legacy-peer-deps
npm run build:bare
npx qvac bundle sdk
npx expo prebuild --platform android --clean
npm run android
```

Type-check:

```powershell
npm run typecheck
```

Two-device test: install on two phones on the same Wi-Fi with the same
"About you" text. Compose a post on one, watch it appear on the other
within a few seconds; reply; watch the reply come back. Toggle Settings
to see all 8 Tier-2 bucket IDs and confirm overlap.

## Adjacent work

Resonance is a companion to:

- [JarvisQ](https://github.com/Helldez/JarvisQ) — a private, on-device
  voice assistant (STT → LLM → TTS, cross-platform).
- [JarvisDocs](https://github.com/Helldez/JarvisDocs) — on-device
  semantic search over personal documents.

Same posture (privacy as constraint, no central server), same building
blocks (QVAC SDK, Bare, Ed25519, Hyperswarm), different product surfaces.

## License

Apache-2.0
