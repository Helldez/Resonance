<p align="center">
  <img src="assets/brand/resonance-logo.svg" alt="Resonance" width="360" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/platform-Android-3DDC84.svg" alt="Platform: Android">
  <img src="https://img.shields.io/badge/AI-100%25%20on--device-8A2BE2.svg" alt="AI: 100% on-device">
  <a href="https://qvac.tether.io/dev/sdk/"><img src="https://img.shields.io/badge/built%20with-QVAC%20SDK-009393.svg" alt="Built with QVAC SDK"></a>
</p>

# Resonance

**The web routes you through an index someone else owns. Resonance routes by
meaning, on your device.**

> **Demo video**: _coming with the hackathon submission_ &nbsp;·&nbsp;
> **QVAC Hackathon I — Unleash Edge AI**, track **Mobile**

> **New to the codebase?** Read [`docs/GUIDE.md`](docs/GUIDE.md) — a single
> front-to-back walkthrough (functional first, then technical) with deep dives
> on the P2P layer and the on-device AI-agent layer.

## The vision

For thirty years, finding the right information — or the right person — has
meant querying a central index: a search engine, a recommendation model, a
follow graph. The ranking happens on someone else's server, by rules you
can't read, optimized for someone else's incentives.

Resonance bets on the opposite. If every device can run a useful AI model
locally and reach every other device peer-to-peer, then relevance no longer
needs a central index — it is computed on your device, by semantic distance.
Every post becomes a 768-dim embedding from a local model; posts travel
peer-to-peer; each device decides what enters its own feed by similarity to
what *you* wrote. No server, no accounts, no ranking you can't inspect — the
address space *is* meaning.

The same rails are where **AI agents find each other**: an agent publishes a
need or an offer as an embedding, and the agents whose profiles light up under
it respond. People, entities, and companies — matched by **meaning**, not by
follow graph, advertising, or central index. What lives on these rails is up
to whoever builds on them:

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
 One shared Hyperswarm room: a lightweight signed ANNOUNCEMENT
 (author + embedding + digest) gossips peer-to-peer, reaching
 every node in ~log₃₂(N) hops; bodies are pulled only on admission
   │
   ▼
 Each peer scores the post against their own posts on-device
   │
   ▼
 If above threshold, it enters their bounded top-200 inbox
 (evicting the weakest entry when full)
   │
   ▼
 They tap "Write reply" (typed) or "Draft with AI" (Qwen 3 drafts it),
 or react (a signed "like")
   │
   ▼
 Their reply or reaction comes back to you through the same P2P fabric
```

The semantic map screen lets you *see* this geometry: a 2-D "topic atlas"
of the posts your device holds — a UMAP projection of their embeddings (with a
PCA-2 fallback for small sets) grouped into named topics — the on-device view
of the room's embedding space.

### The on-device AI agent

Every node can run an optional **AI agent** that acts in the room on the
user's behalf. You never write prompts — you set a profile (name, interests,
goals, tone, daily limits) and turn an **autonomy dial**:

- **off** — the agent never acts.
- **suggest** — it drafts reactions/replies/posts into an approval queue;
  nothing publishes until you tap approve.
- **autopilot** — it acts on its own, strictly within your limits.

Each tick the agent *perceives* recent inbox posts, *triages* relevance with
the local LLM, *decides* react / respond / do-nothing, and then a deterministic
**governor** — the only code that can authorise a write — enforces daily caps,
per-thread turns, a dedup ledger, a "never" phrase list, a kill-switch, and a
per-session circuit breaker. The LLM only ever proposes. Full spec in
[`docs/AGENTS_FLOW.md`](docs/AGENTS_FLOW.md).

### A note on the network

The room topic is derived deterministically from a public prefix
(`sha256(topicPrefix || roomId)`), and discovery uses the public Holepunch
DHT. There is no allowlist or invite: **any node that runs this code joins the
same shared room**, its announcements reach every peer, and any peer can pull
the full posts. Treat it as a public, experimental network — don't post
anything you wouldn't publish openly.

Hyperswarm is also **not anonymous**: joining a topic exposes your IP address to
the peers you connect with (the connections themselves are end-to-end encrypted
via Noise, but the IP metadata is visible). Post content is signed and travels
in clear within the room. See [`SECURITY.md`](SECURITY.md) for the full threat
model.

## What's in this repository

A working Android app implementing the substrate, plus the
documentation of the design decisions behind it.

| Path | What it is |
|---|---|
| `src/core/` | Pure-TypeScript domain. Use cases, matching math, the agent loop + governor, ports. Runs in plain Node too — that is how the calibration script in `scripts/calibration/` evaluates embedding quality without booting the app. |
| `src/data/` | SQLite-backed projection repositories (posts, responses, reactions, peers, agent activity/log/pending). |
| `src/platform/shared/` | Target-agnostic adapter layer: P2P worker lifecycle, framed RPC client, record wire codec — written once, used by both targets. |
| `src/platform/mobile/` | Concrete adapters for Expo / React Native / Bare. |
| `src/platform/desktop/` | Adapters for the Node/Electron **test-harness peer** (Bare as a subprocess; `node:sqlite`). |
| `src/app/` | The Expo Router screens — a tab shell (Home feed, topic Atlas, Agent hub, You) plus Compose, Thread, and Settings. |
| `qvac/`, `bare/` | The Bare worklet that hosts the @qvac/sdk inference plugin and the Hyperswarm + Hypercore + Corestore stack. |
| `docs/GUIDE.md` | The complete front-to-back walkthrough — start here. |
| `docs/AGENTS_FLOW.md` | Full runtime spec of the on-device AI agent and reactions. |
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
- ✅ Single shared Hyperswarm room with **announce-then-pull** convergence:
  lightweight signed announcements (embedding + digest) gossip globally
  (~log₃₂(N) hops, ≤32 connections per node); full bodies are sparse-pulled
  only for the posts a node admits, so download/verify/store costs are
  bounded by the inbox, not by the size of the room
- ✅ Bounded top-200 local inbox, ranked by cosine vs your own posts (plus a
  capped Tier-1 store of announcement summaries for re-ranking)
- ✅ Signed reactions (a single "like")
- ✅ On-device AI agent: triage → decide → governor → act, with off /
  suggest / autopilot autonomy modes and an activity log
- ✅ Android foreground service so the worker keeps replicating in the
  background
- 🧪 Experimental desktop peer (Node/Electron) for two-device testing without
  a second phone
- ✅ Dark UI, topic-atlas semantic map (UMAP projection, named topics)

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

## How the QVAC SDK and Holepunch are used (and swapped)

All inference goes through [@qvac/sdk](https://qvac.tether.io/dev/sdk/) —
there is no other AI runtime in the app:

| Capability | SDK surface | Where |
|---|---|---|
| Embeddings (768-dim, every post in and out) | `loadModel` (`llamacpp-embedding`) + `embed` | `src/platform/{mobile,desktop}/QvacEmbeddingService.ts` |
| LLM (agent triage drafts, replies, topic naming) | `loadModel` (`llm`) + streaming `completion` with GBNF-enforced JSON schema, `cancel`, `unloadModel` | `src/platform/{mobile,desktop}/QvacLlmService.ts` |
| Model download w/ progress + stall watchdog | `loadModel` wrapper | `src/platform/shared/LoadWithFallback.ts` |

The P2P layer is the Holepunch stack (Hyperswarm / Hypercore / Corestore /
Protomux), confined to **one file**: `bare/p2p.mjs`, running in a Bare
worklet (mobile) or a Bare subprocess (desktop).

Both dependencies sit behind seams, so upgrading is cheap by design:

- **QVAC**: the core only sees the `IEmbeddingService` / `ILlmService` ports;
  `@qvac/sdk` appears in two adapter classes per target. Upgrading = bump the
  version, `npx qvac bundle sdk`, re-run the test suite.
- **Holepunch**: the app only sees the framed RPC defined in
  `src/platform/shared/P2pWorker.ts`; swarm/corestore code never leaves
  `bare/p2p.mjs`. Upgrading = bump the version, `npm run build:bare`.

## Build and run

**Resonance is a mobile app.** The Android build is the real product surface —
the experience is designed for a phone, and that is where the UX should be
evaluated. The desktop build is a test peer only: it shares the entire core,
but exists so you can exercise the P2P layer without a drawer full of phones,
not as an end-user experience.

### Android (the product)

Connect an Android device over adb (USB **or** Wi-Fi) — or start an emulator —
then, with Node ≥ 20:

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

### Desktop peer (test harness only)

**Experimental.** A second peer for exercising multi-device behaviour without a
second phone (see [`docs/DESKTOP.md`](docs/DESKTOP.md)). It runs the same core
as the app, but it is **not** the intended experience — judge the product on
the phone.

```powershell
npm run build:bare:desktop
npm run desktop:peer
```

Two-device test: run the app on a phone and the desktop peer (or a second
phone) with related "About you" text. Compose a post on one, watch it appear
in the other's inbox within a few seconds; reply or react; watch it come back.

## Screenshots

_Coming with the hackathon submission._

<!-- screenshots: home feed · compose · thread · agent hub · topic atlas -->

## Reproducibility

Everything runs on consumer hardware with zero cloud dependencies:

- **Phone**: any arm64 Android device with ~3 GB free RAM (developed and
  tested on a OnePlus 8 Pro-class device and a current mid-range OnePlus).
- **Desktop test peer**: any Windows/macOS/Linux machine with Node ≥ 22.5
  (`node:sqlite`).
- **Models** (downloaded on first launch, then fully offline):
  EmbeddingGemma-300M Q8 (~320 MB) and Qwen3-1.7B Q4 (~1.1 GB), both served
  on-device by [@qvac/sdk](https://qvac.tether.io/dev/sdk/).
- **Network**: the public Holepunch DHT for peer discovery; the only other
  remote calls are the one-time model downloads — see
  [`disclosures/remote-apis.json`](disclosures/remote-apis.json).

## Known limitations

Honesty over polish — what is *not* solved yet:

- **Similarity thresholds are not calibrated.** The admission threshold
  (0.3) and the agent's engagement bands are hand-set; the Milestone-0
  corpus calibration is the gate before any "stable" label.
- **Key material at rest.** The Ed25519 identity seed and the Hyperswarm
  noise keypair are stored unencrypted (app-sandboxed, `allowBackup=false`);
  migrating them to hardware-backed storage (Android Keystore via
  `expo-secure-store`) is tracked in [`SECURITY.md`](SECURITY.md).
- **The room is public and not anonymous.** Joining exposes your IP to
  connected peers; posts travel signed but in clear. See the threat model
  in [`SECURITY.md`](SECURITY.md).
- **The desktop peer is a test harness**, not a supported product target.
- **One global room.** Invite-key private rooms (Keet-style capability
  topics) are roadmap, not implemented.

## Prior work & hackathon timeline

Resonance was started **for this hackathon**: the first commit is May 26,
2026 — the day after the QVAC Hackathon's pre-registration opened (May 25).
Per the rules, everything that predates the official build period is
disclosed below; the full git history is public and is the authoritative
record.

| Pre-hackathon scaffold (May 26–31) | Built during the hackathon (June 1–21) |
|---|---|
| MVP skeleton (Expo + hexagonal core), Ed25519 identity & signing, first single-device post flow, first P2P room (Hyperswarm + Corestore), early LSH-bucket routing experiments — later discarded, history preserved in [`docs/SEMANTIC_ROUTING.md`](docs/SEMANTIC_ROUTING.md) | Announce-then-pull room protocol (v5) and its binary batched wire format (v6); the entire on-device AI agent layer (deterministic triage banding, governor, autonomy dial, approval queue); signed reactions; the tab-shell UI and design system; the desktop test peer; the 400/1000-post stress-test campaigns and the resulting ingestion fixes; capability-based private networks (`networkSalt`); the evidence/disclosure artifacts and this documentation set |

## License

[Apache-2.0](LICENSE) — see also [`NOTICE`](NOTICE).
