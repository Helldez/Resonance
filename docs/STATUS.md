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
- **AppContainer + bootstrap**: Buffer polyfill, async DI, idempotent.
  `AppContainerContext` drives stages and exposes the container.
- **UI shell**: Bootstrap → Inbox → Compose → Thread → Settings, all
  functional.
- **Compose**: runs `createPost` end-to-end. Text → embed → bucket →
  sign → mailbox append → SQLite projection → P2P publish.
- **Thread**: shows post + responses, drafts a response via the LLM
  (`DraftResponse`), publishes it to the local outbox and the swarm
  (`PublishResponse`).
- **Inbox**: queries the `posts` table, refreshes on focus.

## P2P layer (real, untested on-device)

- **`bare/p2p.mjs`**: Bare worker that owns a Corestore, a writable
  outbox Hypercore, a Hyperswarm instance, and a Protomux directory
  channel for outbox-key exchange. Bundled by `npm run build:bare` into
  `bare/p2p.bundle.mjs`.
- **`src/platform/mobile/P2pWorklet.ts`**: RN-side facade. Mounts the
  worker via `react-native-bare-kit`, framed JSON RPC over IPC, exposes
  `joinBucket`, `leaveBucket`, `append`, `onRecord`, `onPresence`.
- **`SyncEngine`**: mounted in `AppContainerContext`. Embeds the user's
  "About you" string (or a fallback) on boot, derives the LSH bucket id,
  joins it, and routes incoming records to the inbox.
- **Signature verification**: every received record is verified
  (`canonicalDigest` + `identity.verify`) before being persisted.

## Not yet done

- **M0 — Calibration gate**: corpus + human eval still required.
- **Model checksum verification**: `HttpModelSources.sha256` fields are
  placeholders; @qvac/sdk handles downloads but does not yet check
  these.
- **Multi-perspective synthesis**: responses render individually; no
  "summary of N replies" aggregator.
- **Foreground service / push wake-up**: app-open only for the MVP.
- **iOS**: Android target only.
- **Auto-publish mode** (Settings toggle exists; flow gated off).
- **Reputation / helpful counts**: schema column exists, no UI.

## How to build and run (USB-attached Android device)

```powershell
cd C:\Users\raffa\Documents\Resonance
npm install --legacy-peer-deps
npm run build:bare
npx qvac bundle sdk
npx expo prebuild --platform android --clean
npm run android
```

What happens on first boot:

1. Identity Ed25519 keypair is generated and persisted.
2. `bare/p2p.bundle.mjs` is loaded into a Bare worklet. The worker opens
   a Corestore, creates the outbox Hypercore, and starts Hyperswarm.
3. EmbeddingGemma is downloaded (~270 MB, one-time) by @qvac/sdk.
4. The user's interest profile is embedded; the LSH bucket id is
   computed; the bucket is joined on Hyperswarm.
5. The app lands on the Inbox.

End-to-end use case with N phones:

1. Two phones on the same Wi-Fi (or both reachable on the DHT) both
   boot Resonance.
2. Phone A's "About you" mentions "AI privacy"; phone B's "About you"
   mentions "on-device AI" → both compute the same (or adjacent) LSH
   bucket.
3. Phone A composes a post about a related question. Embed → bucket →
   outbox append → published.
4. Phone B's Bare worker receives the record from Phone A's outbox
   replication, emits it to RN, the SyncEngine scores it with cosine ≥
   threshold, surfaces it in the inbox.
5. Phone B opens the thread, taps "Draft a response" → Qwen 3 generates
   a draft → user edits → publishes. The response propagates back via
   the swarm.
6. Phone A receives the response, persists it, shows it in the thread.

## Known unknowns / things likely to need iteration

- **Bare worklet asset loading**: the Worklet constructor in
  `react-native-bare-kit` expects either a filename (asset path) or a
  source string. We import the bundle as a JS module (default export is
  a string). If this trips on Hermes' string-size limit at runtime
  (~512 MB but shaky), switch to passing the bundle as bytes via
  `Uint8Array`.
- **Corestore storage path**: `P2pWorklet.initialize` derives the path
  from `Paths.document.uri`. On Android the URI starts with `file://` —
  we strip it. If Corestore complains, prefix or normalise.
- **Hyperswarm + Bare on Android**: the underlying `udx-native`,
  `sodium-native`, etc. prebuilds must ship in the APK. The
  `addons.manifest.json` regenerated by `npx qvac bundle sdk` should
  cover them. If a native binding is missing at runtime, regenerate
  the manifest and rerun `expo prebuild`.
- **First-launch Hypercore replication**: corestore needs both sides to
  exchange outbox keys before replication will surface records. The
  Protomux directory channel does this on the same Noise stream — if
  one side never sees the other's records, that channel is the place
  to instrument logs.
- **Bucket density**: with 8 LSH bits we have 256 buckets. With ~2-3
  early-test users, two devices will likely land in different buckets
  unless their "About you" texts are very similar. To force a meeting,
  use the SAME "About you" text on both devices for the first run.
