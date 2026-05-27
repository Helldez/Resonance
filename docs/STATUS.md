# Resonance — Implementation status

Snapshot of what's wired vs. stubbed. Update whenever a TODO turns into
code.

## Done

- **Project scaffold**: Expo + RN + Bare worklet stack, strict TS,
  hexagonal layout (`src/core` → `src/platform/mobile`).
- **Config modules**: every tunable lives in `src/core/config/`.
- **Domain types**: branded `PeerId`, `BucketId`, `RecordAddress`,
  `SignedRecord`.
- **Matching primitives** (real): LSH random hyperplanes (deterministic
  seed), cosine via dot product, L2-normalisation.
- **Crypto** (real): Ed25519 via @noble/ed25519 (RN side), SHA-256 via
  @noble/hashes. Keypair persists through AsyncStorage; public key = PeerId.
- **QVAC inference** (real wiring): EmbeddingService and LlmService call
  @qvac/sdk directly. Matryoshka truncation to 256 dims, L2-normalised.
- **Storage** (real): expo-sqlite repositories, expo-file-system v19,
  AsyncStorage key-value.
- **AppContainer + bootstrap**: Buffer polyfill, `react-native-get-random-values`
  polyfill, async DI, idempotent. `AppContainerContext` drives stages and
  exposes the container.
- **UI shell**: Bootstrap → Inbox → Compose → Thread → Settings, all
  functional.
- **Compose**: runs `createPost` end-to-end. Text → embed → bucket →
  sign → mailbox append → SQLite projection → P2P publish.
- **Thread**: shows post + responses, drafts a response via the LLM
  (`DraftResponse`, with `<think>` stripping), publishes it to the local
  outbox and the swarm (`PublishResponse`). Enforces one-response-per-peer
  via `ResponseRepository.countByAuthorAndPost`.
- **Inbox**: queries the `posts` table, auto-refreshes every
  `MatchingConfig.uiRefreshIntervalMs`, surfaces a "hidden by threshold"
  hint, long-press to delete a local copy.
- **Settings**: threshold preset chips (driven by
  `MatchingConfig.thresholdPresets`), LLM download button with progress
  bar, About-you text. Persisted to AsyncStorage so choices survive a
  restart (`StorageConfig.settingsKvKey`).

## P2P layer (verified on two physical devices)

- **`bare/p2p.mjs`**: Bare worker that owns a Corestore, a writable
  outbox Hypercore, a Hyperswarm instance, and a Protomux directory
  channel for outbox-key exchange. Bundled by `npm run build:bare` into
  `bare/p2p.bundle.mjs`. `outbox.append` returns `{length, byteLength}`
  not the index, so the worker computes `feedIndex` from `outbox.length`
  before appending and stamps it on the record.
- **`src/platform/mobile/P2pWorklet.ts`**: RN-side facade. Mounts the
  worker via `react-native-bare-kit`, framed JSON RPC over IPC, exposes
  `joinBucket`, `leaveBucket`, `append`, `onRecord`, `onPresence`.
- **Single record handler in `AppContainerContext`**: every incoming
  record is digest-checked, signature-verified, scored, and persisted in
  one place. The legacy `SyncEngine` + `InboxStore` indirection is gone.
- **Receiver-side similarity**: `scoreRemotePost` returns
  `max(cosine(post, own_post_i))` across the local user's own post
  embeddings, with the About-you embedding as the cold-start fallback.
  This was the fix for "two phones with the same About-you never matched"
  — the original About-you-only scoring missed the actually-written
  content.
- **Android foreground service** (`plugins/with-foreground-service.js`):
  custom Expo config plugin that adds a `dataSync` foreground service so
  the Bare worker keeps replicating when the app is backgrounded. Mirrors
  Keet's "always on" model. The Kotlin source is rewritten at prebuild
  time to match `android.package`, so there is no hardcoded class FQCN.

## Semantic map (Phase 1, Option A)

- **`src/app/map.tsx`**: starfield UI rendered with `react-native-svg`.
  After publishing a post, the user lands here. The anchor (own post) is
  the central white star; up to `MatchingConfig.mapMaxCandidates` recent
  remote posts are plotted by PCA-2 of their 256-dim embeddings. Pan +
  pinch via `react-native-gesture-handler`. Tap a peer star → snippet
  sheet with similarity and "Open thread".
- **`src/core/matching/Project2D.ts`**: pure-TS deflated power-iteration
  PCA. Deterministic. Runs in plain Node too.
- **`src/core/posts/GetMapCandidates.ts`**: use case wiring the anchor
  fetch + candidate listing + projection. Depends only on a
  `MapRepository` port, not the SQLite class.
- **`src/data/PostRepository.ts`**: `getOneWithEmbedding` + `listForMap`
  read paths; embeddings decoded into `Float32Array` once at the
  repository boundary.
- **Dark theme**: `darkTheme` is now the default in `_layout.tsx`. Colors
  come from `src/core/config/ThemeConfig.ts`.
- **Display name**: `SettingsStore.displayName`, local-only, never
  serialised on the wire. Surfaced in the map header and the Inbox "your
  post" label via `src/domain/AuthorFormatting.ts`.

Routing geometry is unchanged — the map is a UI projection of records
the device already has via Tier 1 replication. See
`docs/SEMANTIC_ROUTING.md` §9.

## Not yet done

- **M0 — Calibration gate**: corpus + human eval still required.
- **Model checksum verification**: `HttpModelSources.sha256` fields are
  placeholders; @qvac/sdk handles downloads but does not yet check them.
- **Multi-perspective synthesis**: responses render individually; no
  "summary of N replies" aggregator.
- **iOS**: Android target only.
- **Auto-publish mode** (Settings toggle exists; flow gated off).
- **Reputation / helpful counts**: schema column exists, no UI.
- **Compose-time per-post probe (Tier 1.5)**: planned if the Phase 1
  map turns out too sparse on the small-cohort test — see
  `docs/SEMANTIC_ROUTING.md` §9.
- **Multi-table LSH / Hamming-1 neighbor join**: planned for Phase 2 to
  fix the cliff where two close embeddings on opposite sides of a single
  hyperplane never see each other.
- **HyperDHT direct routing with LSH as `node_id`** (Semantica-style,
  arXiv 2502.10151): planned for Phase 3 to remove the Hyperswarm topic
  abstraction and route directly by semantic distance.

## How to build and run (USB-attached Android device)

```powershell
cd C:\Users\raffa\Documents\Resonance
npm install --legacy-peer-deps
npm run build:bare
npx qvac bundle sdk
npx expo prebuild --platform android --clean
npm run android
```

Two-device manual test (verified working as of `26a47fc`):

1. Install the APK on both phones with the same About-you text so they
   land in the same LSH bucket.
2. Phone A composes a post. Embed → bucket → outbox append → publish.
3. Phone B's Bare worker receives the record via Hyperswarm + Corestore
   replication; the single record handler verifies signature, scores
   similarity against Phone B's own posts (or the About-you fallback if
   Phone B has none yet), persists into SQLite.
4. The Inbox `setInterval` re-poll surfaces the new post within
   `uiRefreshIntervalMs`. With the foreground service running, this also
   works while the app is backgrounded.
5. Phone B opens the thread, taps "Draft a response" → Qwen 3 generates a
   reply (with `<think>` blocks stripped) → user edits → publishes. The
   response propagates back through the swarm.
6. Phone A receives the response, persists it, shows it in the thread.

## Recent commits

- `26a47fc` Auto-refresh, delete local records, 1-response-per-peer,
  strip Qwen `<think>`
- `0b3a611` Score remote posts against the user's own posts, not
  About-you
- `4249492` M3 polish: real P2P verified on two devices + similarity
  filter
- `06a3741` Bump Android compileSdk to 36 and minSdk to 29
- `ef21558` M3+M4: real P2P via Hyperswarm + Corestore + Protomux;
  response loop
- `a61d5de` M1+M2: real QVAC inference, Ed25519, single-device post
  flow
- `68f3ade` Initial scaffold: Resonance MVP skeleton

## Known unknowns / things likely to need iteration

- **Bucket density**: 8 LSH bits = 256 buckets. With ~2-3 early-test
  users, two devices may land in different buckets unless About-you
  texts overlap. Multi-table LSH (Phase 2) is the durable fix.
- **First-launch Hypercore replication**: corestore needs both sides to
  exchange outbox keys before replication surfaces records. The Protomux
  directory channel handles this — instrument logs there if one side
  never sees the other.
- **Foreground service permissions on Android 13+**: requires user
  approval for the notification, declared in `app.json`. If the user
  denies the notification, the service still runs but the user has no
  affordance to confirm "Resonance is online" status.
