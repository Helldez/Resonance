# Milestone 0 — Calibration

Before we build the P2P network, we need evidence that **semantic
neighbour ≈ useful peer**. This directory holds the standalone scripts
that test that hypothesis offline, without any of the app stack.

## Procedure

1. Collect a `corpus.jsonl` of real posts. One JSON object per line with
   `{ "id": "...", "text": "..." }`. Suggested sources: pushshift-style
   Reddit exports for subreddits where people ask questions about their
   life, work, or hobbies.
2. Run `npm run calibrate`. It will:
   - Load every post in `corpus.jsonl`.
   - Embed each text (model TBD — at first run, swap in an off-the-shelf
     sentence-transformer; later, hook directly into the same QVAC
     worklet the app uses).
   - L2-normalise the full 768-dim EmbeddingGemma-300M output (no Matryoshka
     truncation — 768 is the project-wide convention; see `MatchingConfig.ts`).
   - For each post, write `nearest-<id>.md` with the top-10 nearest
     neighbours by cosine similarity and their similarity scores.
3. Human-review a stratified sample. Mark each top-10 list as:
   - **GOOD** — at least 3 neighbours look like "people who would
     contribute something useful".
   - **MEH** — neighbours are on-topic but unlikely to add value.
   - **BAD** — neighbours are off-topic or surface-level lexical
     matches.
4. Compute the similarity threshold above which the GOOD-rate is at
   least 80%. That value calibrates the inbox admission threshold
   (`RoomConfig.inboxMinSimilarity`) and the `MatchingConfig.thresholdPresets`
   the receiving device applies locally.

> Note: routing is now a single shared room (the "Keet model"), so there are no
> LSH buckets to size. The earlier `lshBits` tuning step is obsolete — see
> `docs/SEMANTIC_ROUTING.md` for why LSH was dropped.

## Why this is a gate

If the calibration shows that semantic neighbours are not, in practice,
"people who would add useful perspective", then no amount of P2P
plumbing will produce a useful product. We'd need to redesign the
matching signal (intent classifier, dual-encoder fine-tune, query
rewriting, etc.) before continuing.

The cost of this experiment is small. The cost of skipping it and
discovering this at M4 is the entire MVP.
