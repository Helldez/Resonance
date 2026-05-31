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
 EmbeddingGemma-300M on-device → 768-dim semantic vector
 (prompt: "task: clustering | query: <text>")
   │
   ▼
 Sign it and append to your personal outbox Hypercore
   │
   ▼
 One shared Hyperswarm room (the "Keet model"): outbox keys gossip
 peer-to-peer, so your post reaches every node in ~log₃₂(N) hops
   │
   ▼
 Each peer scores the post against their own posts on-device
   │
   ▼
 If above threshold, it enters their bounded top-200 inbox
 (evicting the weakest entry when full)
   │
   ▼
 They tap "Write reply" (typed) or "Draft with AI" (Qwen 3 drafts it)
   │
   ▼
 Their reply comes back to you through the same P2P fabric
```

The semantic map screen lets you *see* this geometry: a 2-D PCA projection
of the posts your device holds, each point coloured by its author, your
anchor post highlighted — the on-device view of the room's embedding space.

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
| `docs/SEMANTIC_ROUTING.md` | Historical design rationale for the LSH routing that preceded the single-room model — why those mechanisms were tried and dropped. |
| `docs/ROADMAP.md` | Milestones M0 → M5. |
| `docs/STATUS.md` | Implementation snapshot — what is wired vs. stubbed. |
| `SECURITY.md` | Audit of the on-device key material, threat model, Phase-2 hardening roadmap. |
| `AGENTS.md` | The non-negotiable rules for AI coding agents working on this repo. |

## Status

Pre-MVP, but functional end-to-end on two devices. The current build
demonstrates:

- ✅ Ed25519 identity, on-device key generation, signed records
- ✅ EmbeddingGemma 300M Q8 + Qwen 3 1.7B Q4 running locally via @qvac/sdk
- ✅ Single shared Hyperswarm room with directory-gossip global convergence
  (~log₃₂(N) hops, ≤32 connections per node)
- ✅ Bounded top-200 local inbox, ranked by cosine vs your own posts
- ✅ Android foreground service so the worker keeps replicating in the
  background
- ✅ Dark UI, PCA-2 semantic map coloured by author

The Milestone 0 calibration (corpus-based threshold tuning) is the gate
before public release.

## Stack

- React Native + Expo (Android target for the MVP)
- Bare worklet hosting [@qvac/sdk](https://qvac.tether.io/dev/sdk/) for
  on-device embeddings and LLM, and Hyperswarm / Hypercore / Corestore
  for P2P
- Strict TypeScript, hexagonal architecture
- Embeddings: EmbeddingGemma 300M (Q8_0, 768-dim, clustering prompt, L2-normalised)
- LLM: Qwen 3 1.7B Instruct (Q4_0)
- Identity: Ed25519 via `@noble/ed25519`
- DHT identity: Hyperswarm noise keypair (persisted across restarts for a
  stable presence in the room)

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

## License

Apache-2.0
