# Resonance — Implementation status

Snapshot of what's wired vs. stubbed. Update whenever a TODO turns into
code.

## Done

- **Project scaffold**: Expo + RN + Bare worklet stack, strict TS,
  hexagonal layout (`src/core` → `src/platform/mobile`).
- **Config modules**: every tunable lives in `src/core/config/`
  (`AppConfig`, `MatchingConfig`, `ModelProfiles`, `HttpModelSources`,
  `NetworkConfig`, `StorageConfig`). No hardcoded constants at call sites.
- **Domain types**: `Post`, `Response`, `Peer`, `SignedRecord`,
  `BucketId`, `RecordAddress` — all branded TS types in
  `src/core/domain/types.ts`.
- **Matching primitives** (real, not stubs):
  - `src/core/matching/LshBucket.ts` — LSH via signed random hyperplanes
    with deterministic seed.
  - `src/core/matching/CosineSimilarity.ts` — dot product on
    L2-normalised vectors.
  - `src/core/matching/L2Normalize.ts` — in-place unit-norm.
- **Crypto** (real, not stubs):
  - `src/platform/mobile/Ed25519Identity.ts` — @noble/ed25519, keypair
    persisted via `AsyncStorage`, public key = `PeerId`.
  - `src/core/utils/CanonicalRecord.ts` — SHA-256 via @noble/hashes over
    canonical-JSON record bodies.
- **QVAC inference** (real wiring):
  - `src/platform/mobile/QvacEmbeddingService.ts` — `@qvac/sdk` `embed`,
    Matryoshka truncation, L2-normalise, deferred load.
  - `src/platform/mobile/QvacLlmService.ts` — `@qvac/sdk` `completion`
    with streaming `tokenStream`.
  - `src/core/utils/LoadWithFallback.ts` — stall watchdog + optional
    HTTPS fallback for `loadModel`.
- **Storage** (real wiring):
  - `src/platform/mobile/ExpoSqliteDatabase.ts` — expo-sqlite, lazy
    open, transactions.
  - `src/platform/mobile/ExpoFileSystem.ts` — expo-file-system v19 API
    (`Paths`/`File`/`Directory`).
  - `src/data/{Post,Response,Peer}Repository.ts` — schemas + upserts.
- **AppContainer + bootstrap** (real wiring):
  - `src/platform/mobile/bootstrap.ts` — Buffer polyfill, async DI,
    idempotent.
  - `src/ui/AppContainerContext.tsx` — drives the bootstrap stages,
    surfaces progress to the Bootstrap screen.
- **UI shell** (functional, navigates):
  - Bootstrap → Inbox → Compose → Thread → Settings, all real screens.
  - Compose runs `createPost` end-to-end: text → embed → bucket → sign →
    mailbox.
  - Inbox lists from `posts` table, refreshes on focus.
  - Thread reads post + responses from SQLite.
- **Mailbox in-memory** — `BareWorkletMailbox` provides ordered
  append/iterate semantics that match the future Hypercore-backed
  version, so use cases stay unchanged when M3 swaps the backend.
- **Typecheck passes**: `npm run typecheck` clean.

## Not yet done (with milestone tag)

- **M0 — Calibration gate**: corpus + human eval. `scripts/calibration/`
  has the scaffold and README; the corpus and the evaluation are your
  call.
- **M1 — Model checksum verification**: SHA-256 fields in
  `HttpModelSources.ts` are placeholders. Fill them on first download.
- **M3 — P2P**: `BareWorkletNetwork` is a no-op event source; needs the
  Hyperswarm/Hypercore Bare worker. Replace `BareWorkletMailbox` with a
  Hypercore-backed implementation at the same time.
- **M4 — Response drafting**: Thread screen has the "Draft a response"
  button disabled. The `DraftResponse` use case is ready; just needs
  wiring to a screen state machine and a publish path through the
  network.
- **M5 — Polish**: foreground service decision, real similarity slider,
  threshold calibration from M0, multi-device QA, push relay opt-in.

## How to run (local single-device flow)

```powershell
cd C:\Users\raffa\Documents\Resonance
npm install --legacy-peer-deps
npx qvac bundle sdk            # regenerates qvac/worker.entry.mjs if needed
npx expo prebuild --clean
npm run android
```

On first boot:
1. Identity keypair is created and persisted.
2. EmbeddingGemma is downloaded via `@qvac/sdk` (progress shown on the
   Bootstrap screen).
3. App lands on the Inbox.
4. Compose → write a post → tap Post.
5. The post is embedded, bucketed, stored in SQLite, and shown in the
   Inbox and Thread views. No peers yet — that's M3.
