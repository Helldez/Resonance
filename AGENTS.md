# AGENTS.md — instructions for AI coding agents working on Resonance

> The same file (no other guidance file) governs every AI-assisted change to
> this repo. Read it before editing.

## What this project is

Resonance is a **local-first P2P social network**. A user writes a thought,
need or topic. The text is embedded on-device, broadcast through a semantic
bucket on Hyperswarm, picked up by peers whose interest profile is close in
embedding space, and answered by their on-device LLM (either as a draft they
confirm, or — opt-in — auto-published on their behalf). Answers come back
through the same P2P fabric and are aggregated on the requester's device.

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
  `ModelProfiles.ts`; networking parameters in `NetworkConfig.ts`; storage
  paths in `StorageConfig.ts`.
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

- Embeddings come from **bge-m3** (BAAI, GGUF Q8_0). Native dim **1024**,
  L2-normalised at ingest. bge-m3 is NOT trained with Matryoshka
  representation learning, so dim truncation destroys signal — keep the full
  1024. Cosine similarity is computed as a plain dot product on L2-normalised
  vectors.
- Vectors stored as little-endian `Float32Array` BLOBs in SQLite. On boot,
  `PostRepository.dropIfDimChanged` drops any post whose stored embedding
  byte-length is incompatible with the active model — handles model swaps
  without leaking stale vectors into matching.
- Coarse routing uses **LSH (signed random hyperplanes)** to map a vector to
  an N-bit bucket id. The bucket id is the Hyperswarm topic. Parameters live
  in `MatchingConfig.ts`.
- **Publishing**: each post is published in a **single** bucket computed via
  `lshBucketOf(post, lshSeed)` (single-seed) so the record has one canonical
  replica home.
- **Listening**: a peer subscribes to the buckets where its **most recent own
  posts** were published (same single-seed, symmetric to publishing), deduped.
  If fewer than `lshTables` distinct buckets emerge (mono-topic user), the
  remaining slots are filled with **multi-table** buckets of the centroid (or
  About-you in cold start) via `lshBucketsOf` — recovers the classical LSH
  recall when per-post coverage is too sparse. See
  `src/core/matching/ComputeListeningBuckets.ts`.
- The fine-grained similarity threshold is applied **on the receiving peer's
  device** against the receiver's own interest profile. It is a local
  decision, never imposed by the network. The threshold presets in
  `MatchingConfig.thresholdPresets` are the same vocabulary the map's
  reference rings use (`mapReferenceRings.similarities`); the ring matching
  the active threshold is highlighted at render time.
- The network is versioned via `NetworkConfig.topicPrefix`. Bumping it
  (currently `resonance/v2/bucket/`) isolates peers using incompatible
  embedding spaces or routing algorithms.

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
- Matching: `src/core/matching/` (LSH bucket → cosine similarity →
  L2 normalisation)
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
- Don't bring matching, LSH or similarity logic out of `src/core/matching/`.
- Don't put network code outside the Bare worklet or the
  `IPeerNetwork` adapter — the rest of the app sees a port, not Hyperswarm.
