# Resonance — Roadmap

Milestones M1–M5 (the original 6-week MVP plan) are **substantially
complete**: real on-device inference, Ed25519 identity, the P2P response
loop, and polish are all wired and verified on two physical devices. Since
then the project added an on-device **AI-agent layer**, **signed reactions**,
and a **topic-atlas** map. The remaining gate is **M0 (calibration)**.

For the live snapshot of what is wired vs. stubbed, see [`STATUS.md`](STATUS.md).

## Gate: Milestone 0 — Calibration (open)

**No app code.** Standalone Node.js script under `scripts/calibration/`.

Pull ~200 real questions/needs from public sources. For each, run
EmbeddingGemma (768-dim, the same model the app uses) and compute the top-10
cosine neighbours. Human-rate whether the neighbours look like "people who
would have something useful to add".

Output that updates the codebase: the similarity threshold above which the
GOOD-rate is ≥ 80% calibrates `RoomConfig.inboxMinSimilarity` and the
`MatchingConfig.thresholdPresets`. If signal-to-noise is bad, redesign the
matching signal before going further. This gate is the cheapest possible
falsification of the product thesis.

> Routing is now a single shared room, so there are no LSH buckets to size —
> the old `lshBits` tuning step is obsolete (see [`SEMANTIC_ROUTING.md`](SEMANTIC_ROUTING.md)).

## Done — M1–M5 (MVP)

- **M1 — Foundations**: Bare worklet boots; `Ed25519Identity` round-trips;
  canonical SHA-256 digest wired; bootstrap drives model download to "Ready".
- **M2 — Local primitives**: real 768-dim L2-normalised embeddings; real Qwen
  output; personal Hypercore append/iterate; Compose runs `createPost`
  end-to-end on a single device.
- **M3 — P2P**: Hyperswarm + Corestore + directory gossip in the worker; the
  single record handler scores and persists peer records; two physical Android
  devices see each other's posts with similarity filtering.
- **M4 — Response loop**: Thread screen + LLM-drafted, user-confirmed replies;
  `PublishResponse` propagates back to the requester via the swarm.
- **M5 — Polish**: threshold presets, dark theme, error handling on
  download/peer failures, real-device testing.

## Done — beyond the original MVP plan

- **Single-room model** (conf 9): replaced the LSH/bucket routing with
  one shared room + directory gossip; reverted embeddings to EmbeddingGemma-300M
  768-dim. History preserved in [`SEMANTIC_ROUTING.md`](SEMANTIC_ROUTING.md).
- **Announce-then-pull (topic v5)**: replaced replicate-every-core with
  lightweight announcement gossip (`resonance-announce/v1`) + on-demand sparse
  single-block pulls; two-tier inbox (Tier-1 announcement summaries, cap 5000;
  Tier-2 bounded posts, cap 200); pulled bodies are verified and re-scored on
  the verified embedding. Validated bidirectionally desktop↔mobile. Flow in
  [`MATCHING_FLOW.md`](MATCHING_FLOW.md).
- **Android foreground service**: always-on replication while backgrounded
  (was originally out of MVP scope).
- **On-device AI agent**: triage → decide → governor → act, with
  off/suggest/autopilot autonomy, activity log, and approval queue. Spec in
  [`AGENTS_FLOW.md`](AGENTS_FLOW.md).
- **Signed reactions**: a `ReactionBody` record kind (currently a single
  `like`), one reaction per (author, target).
- **Topic atlas**: UMAP/PCA 2-D map with spherical-k-means topic grouping and
  optional LLM topic naming.
- **Input-length DoS bounds**: `maxPostChars` / `maxResponseChars` enforced on
  both authoring and ingestion.
- **Experimental desktop peer**: Node/Electron node sharing the same core, for
  two-device testing without a second phone (see [`DESKTOP.md`](DESKTOP.md)).

## Next

- **Close M0**: run the calibration corpus and lock the similarity threshold.
- **Model checksum verification**: fill `HttpModelSources.sha256` and verify
  downloads.
- **Multi-perspective synthesis**: aggregate N replies into a summary instead
  of rendering them individually.
- **At-rest key encryption**: migrate the identity seed to `expo-secure-store`
  (Android Keystore). See [`../SECURITY.md`](../SECURITY.md).

## Later / research

- **Scaling**: HNSW local index for inbox scoring, time-decayed relevance,
  affinity-based connection slots, and possible multi-room semantic
  partitioning if a single room gets too dense.
- **iOS** support.
- **Reputation / web-of-trust**, authenticated handshakes, and private-set /
  homomorphic similarity (embeddings currently travel in clear).

## Explicitly out of scope

- A server, accounts, analytics, or any cloud round-trip — ever.
- Push-notification relay (centralised wake-up).
- A "share to social" surface.
