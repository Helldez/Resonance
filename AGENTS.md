# AGENTS.md — instructions for AI coding agents working on Resonance

> The same file (no other guidance file) governs every AI-assisted change to
> this repo. Read it before editing.

## What this project is

Resonance is a **local-first P2P social network**. A user writes a thought,
need or topic. The text is embedded on-device and broadcast into a **single
shared room** on Hyperswarm (the "Keet model" — ResonanceSim conf 9). Every
peer eventually receives every post via directory gossip, ranks it locally
against its own posts (cosine similarity), and keeps the best ones in a
bounded inbox. Posts the receiver finds relevant are answered by their
on-device LLM (a draft they confirm, or — opt-in — auto-published). Answers
come back through the same P2P fabric and are aggregated on the requester's
device.

Companion to [JarvisQ](https://github.com/Helldez/JarvisQ) and
[JarvisDocs](https://github.com/Helldez/JarvisDocs). Same stack
(Tether QVAC SDK + Bare worklet + Expo), different product surface.

Android is the only first-class target for the MVP. A **desktop peer**
(Node CLI + Electron shell) exists under `src/platform/desktop/` so
contributors can run a second Resonance node on a development machine
and exercise the P2P matching path end-to-end without provisioning a
second phone. See `docs/DESKTOP.md` for the runbook. iOS later.

## Project posture (non-negotiable)

These rules apply to Resonance **and** to any public output written by an
agent on its behalf (commits, PRs, READMEs, issues, social posts).

1. **Privacy is the constraint, not a feature.** No telemetry, no cloud
   round-trips, no analytics SDKs. No central server, ever — not even "for
   the MVP".
2. **All code, identifiers, UI strings and comments are in English.** Italian
   appears only in the user-facing in-app i18n table (none yet) and in
   conversational answers when the user writes Italian.
3. **No "hire me" framing in any public output.** This is a craft showcase,
   not a job application. Stick to product/engineering language.
4. **Show, don't tell.** Anywhere the README or a comment might say "we care
   about X", replace it with an artifact that demonstrates X.

## Coding rules

- **Strict TypeScript.** `strict`, `noImplicitAny`, `strictNullChecks`,
  `noUnusedLocals`, `noUnusedParameters` are all on.
- **No regex.** Use char/line walks. The only exceptions are SQL `LIKE` and
  similar runtime queries — those are not regex.
- **No hardcoded constants at call sites.** Add them to a config file under
  `src/core/config/`. Tunables for matching/similarity/prompts go in
  `MatchingConfig.ts`; model URLs in `HttpModelSources.ts`; model entries in
  `ModelProfiles.ts`; the single room (id, topic prefix, connection cap,
  inbox capacity/threshold) in `RoomConfig.ts`; Hyperswarm bootstrap in
  `NetworkConfig.ts`; storage paths in `StorageConfig.ts`.
- **Hexagonal boundaries.** `src/core/**` never imports Expo, React Native,
  Node, Bare or any platform-specific module directly. It only imports from
  `@core/ports/*`. Platform code lives under `src/platform/<target>/` —
  currently `mobile/` (Expo + react-native-bare-kit) and `desktop/`
  (Node + Electron + standalone `bare` runtime).
- **One responsibility per file.** Use cases, parsers, repositories and
  services each live in their own file.
- **No backwards-compat shims.** If something is unused, delete it.
- **Comments only where the WHY is non-obvious.** Don't restate the WHAT.

## Matching conventions

> The end-to-end runtime flow (publish → room → gossip → receive → score →
> bounded inbox) is documented in [`docs/MATCHING_FLOW.md`](docs/MATCHING_FLOW.md).
> Read it before changing anything in `src/core/matching/`,
> `src/core/inbox/`, `src/core/posts/CreatePost.ts`, or the record handler in
> `src/ui/AppContainerContext.tsx`.

- Embeddings come from **EmbeddingGemma-300M** (GGUF Q8_0). Native dim **768**,
  used in full and L2-normalised at ingest. Every text is prefixed with the
  `task: clustering | query: {text}` template (`ModelProfiles.embedding.
  promptTemplate`) before embedding. Cosine similarity is a plain dot product
  on the L2-normalised vectors.
- Vectors stored as little-endian `Float32Array` BLOBs in SQLite. On boot,
  `PostRepository.dropIfDimChanged` drops any post whose stored embedding
  byte-length is incompatible with the active model — handles model swaps
  without leaking stale vectors into matching.
- **Routing is a single shared room** (conf 9). There is **no LSH, no buckets,
  no DHT routing table, no sticky peers**. Every node joins one Hyperswarm
  topic (`sha256(RoomConfig.topicPrefix || RoomConfig.roomId)`); peer outbox
  keys gossip transitively over the `resonance-directory/v2` protocol
  (`bare/room-directory.mjs`) so every post reaches every peer in ~log₃₂(N)
  hops. Connection fan-out is capped at `RoomConfig.maxConnections` (32).
- **Publishing**: embed → sign → append to the peer's own outbox Hypercore.
  No per-post routing — the room was joined once at boot.
- **Receiving / inbox**: each remote post is scored as the MAX cosine against
  the user's own posts (cold-start fallback: the "About you" embedding), then
  passed through the bounded top-K admission rule in
  `src/core/inbox/InboxAdmission.ts` — drop below `RoomConfig.inboxMinSimilarity`,
  admit while under `RoomConfig.inboxCapacity`, else replace the weakest if the
  newcomer scores higher.
- The fine-grained view threshold is applied **on the receiving peer's device**
  against the receiver's own interest profile — a local decision, never imposed
  by the network. The presets in `MatchingConfig.thresholdPresets` are the same
  vocabulary the map's radial reference rings use.
- The network is versioned via `RoomConfig.topicPrefix` (currently
  `resonance/v3/room/`). Bumping it isolates peers using incompatible embedding
  spaces or topologies.

## P2P conventions

- Identity is an Ed25519 keypair. Public key = peer id. Private key never
  leaves the device, stored via the platform's secure key-value store.
- Each peer owns one **personal Hypercore append-only feed** containing
  signed `Post` and `Response` records.
- Posts are addressed by `<peerPublicKey>:<feedIndex>`. Responses point at
  the post they answer by that address.
- Replication uses Hyperswarm + Hypercore. No relays in the MVP.
- The Bare worklet at `qvac/worker.entry.mjs` owns all P2P + AI state. The
  React Native side is a typed RPC client.

## Build & run

```powershell
npm install --legacy-peer-deps
npx expo prebuild --clean
npm run android
```

Type-check:

```powershell
npm run typecheck
```

Calibration script (Milestone 0):

```powershell
npm run calibrate
```

Desktop peer (second device for testing — see `docs/DESKTOP.md`):

```powershell
npm run build:bare:desktop
npm run desktop:peer
```

## File map for orientation

- Entry: `src/app/_layout.tsx` → `src/app/index.tsx`
- Bootstrap: `src/platform/mobile/bootstrap.ts` → `AppContainer`
- Inference: `src/core/inference/EmbeddingService.ts`,
  `src/core/inference/LlmService.ts`
- Matching: `src/core/matching/` (cosine similarity, L2 normalisation, PCA-2
  map projection) + `src/core/inbox/` (bounded top-K admission)
- Use cases: `src/core/{posts,responses,identity}/`
- Network sync: `src/core/net/SyncEngine.ts`
- Storage: `src/data/*Repository.ts` over `src/platform/mobile/ExpoSqliteDatabase.ts`
- Worklet: `qvac/worker.entry.mjs`
- Roadmap: `docs/ROADMAP.md`
- Architecture: `docs/ARCHITECTURE.md`

## What NOT to do

- Don't add a server. Don't add analytics. Don't add a sign-in. Don't add a
  "share to social" button.
- Don't introduce a global state library beyond the existing Zustand stores.
- Don't add a UI library beyond `react-native-paper`.
- Don't bring matching or similarity logic out of `src/core/matching/` /
  `src/core/inbox/`.
- Don't put network code outside the Bare worklet or the
  `IPeerNetwork` adapter — the rest of the app sees a port, not Hyperswarm.
