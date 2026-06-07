# Resonance — Implementation status

Snapshot of what's wired vs. stubbed. Update whenever a TODO turns into
code. For the full design, start with [`GUIDE.md`](GUIDE.md); routing
history lives in [`SEMANTIC_ROUTING.md`](SEMANTIC_ROUTING.md).

## Done

### Foundations
- **Project scaffold**: Expo + RN + Bare worklet stack, strict TS,
  hexagonal layout (`src/core` → `src/platform/{mobile,desktop}`). Every
  tunable lives in `src/core/config/`.
- **Domain types**: branded `PeerId`, `RecordAddress`, signed
  `PostBody` / `ResponseBody` / `ReactionBody` (`src/core/domain/types.ts`).
- **Crypto** (real): Ed25519 via `@noble/ed25519`, SHA-256 via
  `@noble/hashes`. Private seed persists in the KV store; public key = PeerId.
  Canonical signing in `src/core/utils/CanonicalRecord.ts`.
- **QVAC inference** (real): `IEmbeddingService` / `ILlmService` ports backed
  by `QvacEmbeddingService` / `QvacLlmService` over the @qvac/sdk Bare worker.
  EmbeddingGemma-300M, **768-dim**, L2-normalised, `task: clustering` prompt.
  LLM is Qwen3-1.7B-Q4.
- **Storage** (real): SQLite projection repositories (`src/data/`),
  expo-file-system, AsyncStorage KV. SQLite is a projection; Hypercore feeds
  are the source of truth.

### P2P layer (single room, announce-then-pull, room v6 — validated bidirectionally desktop↔mobile)
- **`bare/p2p.mjs`**: Bare worker owning a Corestore, a writable outbox
  Hypercore, a Hyperswarm instance, the announce-gossip channel and the sparse
  `pull` RPC. Bundled by `npm run build:bare` (mobile) /
  `build:bare:desktop`.
- **Single shared room**: every node joins one Hyperswarm topic
  `sha256(RoomConfig.topicPrefix + networkSalt || roomId)`
  (`resonance/v6/room/`, `global`; the salt is empty on the public network —
  a shared secret salt yields a private one, see `SECURITY.md`).
  **No LSH, no buckets, no routing table.** Signed **announcements** (author +
  outbox key + full float32 embedding + digest) gossip transitively over
  `resonance-announce/v2` (`bare/announce-directory.mjs`; binary
  compact-encoding via `bare/announce-codec.mjs`, snapshots batched at
  `RoomConfig.announceBatchSize`), reaching every peer
  in ~log₃₂(N) hops; ≤32 connections per node. The worker re-announces its own
  outbox on boot.
- **Bodies are pulled, not replicated**: an admitted announcement triggers
  `pull(author, feedIndex)` — the author's core is opened sparse
  (`swarm.join(discoveryKey)` + `findingPeers`) and exactly ONE block is
  downloaded (proven by `scripts/spike/sparse-pull.spike.ts`). Download,
  signature verification and body storage are paid only for the bounded
  admitted set; the announcement stream is the only O(N) cost.
- **Two handlers** in `src/app-services/NetworkIngestion.ts` (wired by
  `src/ui/AppContainerContext.tsx`): `handleAnnouncement`
  (score → Tier-1 → pull if admitted) and `persistRecord` (length-check,
  digest+signature verify, re-score on the VERIFIED embedding, commit). A
  boot-time `rescan()` drains announcements that arrived before the handlers
  attached. The legacy `SyncEngine` indirection is gone.
- **Receiver-side similarity**: `scoreAgainstOwn` =
  `max(cosine(post, own_post_i))` across the user's own posts, with the
  About-you embedding as the cold-start fallback
  (`src/core/inbox/ScoreAgainstOwn.ts`, shared by ingest and re-rank).
- **Two-tier bounded inbox**: Tier-1 = `announcements` summary table
  (`src/data/AnnouncementRepository.ts`, cap
  `RoomConfig.announceTier1Capacity` 5000, lowest-scoring non-pulled evicted
  first) for global ranking and re-ranking; Tier-2 = top-K admission
  (`src/core/inbox/InboxAdmission.ts`) — capacity 200, drop below
  `RoomConfig.inboxMinSimilarity` (0.3), else replace the weakest if the
  newcomer scores higher.
- **Input bounds (DoS hardening)**: `RoomConfig.maxPostChars` (4000) and
  `maxResponseChars` (2000) are enforced on both the authoring and receiving
  sides, so a hostile peer can't ship an unbounded payload.
- **Android foreground service** (`plugins/with-foreground-service.js`):
  `dataSync` service so the Bare worker keeps replicating when backgrounded.
  Kotlin source is rewritten at prebuild time to match `android.package`.

### Reactions
- A third signed `RecordKind` (`ReactionBody`). The vocabulary is currently a
  single `like` (collapsed from four; the field stays in the signed body so the
  wire format can carry more kinds later without a topic bump).
- `ReactionRepository` keeps **one reaction per (author, target)**, newest wins.
  `PublishReaction` signs → appends → publishes; UI in `ReactionRow.tsx`.

### On-device AI agent
- Optional per-node agent (`src/core/agent/`): perceive → triage → decide →
  **governor** → act → remember, on a 45 s tick. Autonomy dial
  **off / suggest / autopilot**.
- The deterministic `ActionGovernor` is the only code that authorises a write:
  daily caps, per-thread turns, dedup ledger (Jaccard), a "never" phrase list,
  kill-switch, and a per-session circuit breaker (`sessionActionBudget = 12`).
- Structured LLM I/O (`src/core/llm/StructuredLlm.ts`): `/no_think`, strip
  `<think>`, extract balanced JSON, one retry, else do_nothing.
- Screens: **Agent** (profile + dial), **Activity** (why-it-acted/why-not log),
  **Approvals** (suggest-mode queue). Full spec in [`AGENTS_FLOW.md`](AGENTS_FLOW.md).

### Topic atlas (semantic map)
- `src/app/(tabs)/atlas.tsx` + `src/ui/TopicAtlasView.tsx`: a 2-D atlas of the posts the
  device holds. Layout is a **UMAP** projection of the 768-dim embeddings, with
  a deterministic **PCA-2** fallback for small sets (`src/core/topics/`,
  `AtlasProjection.ts`). Spherical k-means groups posts into named topics
  (optional on-device LLM naming). Replaces the earlier per-post PCA map.
- Tunables in `src/core/config/TopicConfig.ts`; deterministic via a fixed seed.

### Desktop peer (experimental)
- A Node/Electron peer (`src/platform/desktop/`) runs the **same** core and the
  same `bare/p2p.mjs` (spawned as a subprocess over loopback TCP) so a second
  node can be exercised without a second phone. SQLite via built-in
  `node:sqlite`. See [`DESKTOP.md`](DESKTOP.md). Development aid, not a shipped
  surface.

## Not yet done

- **M0 — Calibration gate**: corpus + human eval still required before tuning
  the similarity threshold. See `scripts/calibration/`.
- **Model checksum verification**: `HttpModelSources.sha256` fields are
  placeholders; @qvac/sdk downloads but does not yet verify them.
- **Multi-perspective synthesis**: responses render individually; no
  "summary of N replies" aggregator.
- **At-rest key encryption**: the KV store is unencrypted on Android; mitigated
  by `allowBackup=false`, with a planned `expo-secure-store` migration
  (see [`../SECURITY.md`](../SECURITY.md)).
- **iOS**: Android is the only first-class target.
- **Reputation / web-of-trust**: out of scope for the MVP.
- **Scaling work** (HNSW local index, time-decayed scoring, affinity-based
  connection slots, possible multi-room partitioning): deferred — see
  [`ROADMAP.md`](ROADMAP.md).

## How to build and run (USB-attached Android device, Node ≥ 20)

```powershell
npm install --legacy-peer-deps
npm run build:bare
npx qvac bundle sdk
npx expo prebuild --platform android --clean
npm run android
```

Two-device manual test: run the app on a phone and the desktop peer (or a
second phone) with related "About you" text. Compose a post on one; it appears
in the other's inbox within a few seconds (signature-verified, scored,
persisted). Open the thread, reply (typed or AI-drafted) or react; the response
propagates back through the same swarm. With the foreground service running,
this also works while the app is backgrounded.

## Known unknowns / things likely to need iteration

- **First-launch replication**: Corestore needs both sides to exchange outbox
  keys before records surface. The directory-gossip channel handles this —
  instrument its logs if one side never sees the other.
- **Foreground service permissions on Android 13+**: requires the user to
  approve the notification (declared in `app.json`). If denied, the service
  still runs but the user has no "Resonance is online" affordance.
- **Single-room bandwidth**: per-node load grows ~linearly with active peers;
  fine at small/medium scale, dense for very large populations (the historical
  LSH partitioning design is kept in [`SEMANTIC_ROUTING.md`](SEMANTIC_ROUTING.md)).
