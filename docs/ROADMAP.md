# Resonance — Roadmap

## Gate: Milestone 0 — Calibration (week 1)

**No app code.** Standalone Node.js script under `scripts/calibration/`.

Pull ~200 real questions/needs from public sources (Reddit JSON exports
on AskParents, AskScience, RelationshipAdvice, AskTech, etc.). For each
post, run EmbeddingGemma (or a stand-in if not yet wired) and compute
top-10 cosine neighbours. Human-rate whether the neighbours look like
"people who would have something useful to add".

Outputs that update the codebase:
- `MatchingConfig.inboxSimilarityThreshold` — set to whatever value
  separates "useful" from "noise" at the 80th-percentile precision.
- `MatchingConfig.lshBits` — set so the expected bucket population is
  small enough to load but large enough to find matches.

If signal-to-noise is bad, redesign before going further. This gate is
the cheapest possible falsification of the product thesis.

## Milestone 1 — Foundations (week 2)

- Bare worklet boots and answers `ping`.
- `Ed25519Identity` round-trips through the worklet (`bare-crypto`).
- `canonicalDigest` is wired (SHA-256 via worklet).
- `ExpoModelRegistry` downloads a small test file with checksum verify.
- Bootstrap screen drives the model download flow end-to-end with the
  embedding model.

Exit criterion: bootstrap screen reaches "Ready" on a clean install.

## Milestone 2 — Local primitives (week 3)

- `QvacEmbeddingService.embed` returns a real 256-dim L2-normalised
  vector.
- `QvacLlmService.complete` returns real Qwen 3 output.
- `BareWorkletMailbox` wraps a personal Hypercore feed; append + iterate
  work locally.
- Compose screen runs `createPost` end-to-end — but `network.publish`
  remains a stub and `joinBucket` is local-only.

Exit criterion: a post round-trips text → embedding → bucket → own feed
on a single device.

## Milestone 3 — P2P (week 4)

- Hyperswarm wired in the worklet.
- `BareWorkletNetwork` actually joins/leaves buckets and emits
  `onRecord` events from peer replication.
- `SyncEngine` is mounted at app startup and feeds the inbox.

Exit criterion: two physical Android devices in the same Wi-Fi see each
other's posts in the same bucket, with similarity filtering applied.

## Milestone 4 — Response loop (week 5)

- Thread screen shows the post + draft response area.
- `DraftResponse` produces a real Qwen draft using
  `SettingsStore.receiverContext`.
- `PublishResponse` writes the (user-edited) response to own feed and
  propagates to the requester via the bucket swarm.
- Requester sees responses appear under the original post (via
  `IDatabase` projection + a thread query).

Exit criterion: full request-reply between two devices, user-confirmed
draft.

## Milestone 5 — Polish (week 6)

- Settings: real similarity threshold slider, calibrated default.
- Error handling on download failures, checksum mismatches, lost peers.
- Real-device testing on 2-3 mid-range Android phones.
- README updated with a 60-second demo gif.

## Explicitly out of scope for the MVP

- iOS.
- Mode A (auto-publish) actually firing — the toggle exists in settings
  but the publishing path is gated off.
- Foreground service for always-on P2P. App-open only.
- Push notification relay (centralised wake-up).
- Fuzzy PSI / homomorphic similarity. Embeddings are sent in clear.
- Multi-perspective synthesis (the "summary of 5 replies" feature). MVP
  shows responses individually.
- Reputation, web-of-trust, helpful/unhelpful voting (the DB column
  exists for forward-compat; no UI).
- More than one swarm bucket joined simultaneously.
- More than one embedding profile per user.
