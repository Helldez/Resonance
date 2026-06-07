# Resonance — Matching Flow (operational baseline, v6 announce-then-pull)

This document describes **what actually happens at runtime** when a peer
publishes a post and when another peer receives one. It is the baseline for
every future optimisation: any change to throughput, recall, privacy, or
battery has to be argued against this concrete flow, not against an abstract
model.

The current topology is a **single shared Hyperswarm room** running an
**announce-then-pull** protocol (network version `resonance/v6/room/`).
Lightweight signed **announcements** gossip to every peer; full record bodies
are **pulled on demand**, only for the records a node admits into its bounded
inbox. Ranking is global (every post's embedding is scored); download,
signature verification and storage are paid only for the bounded set a node
keeps.

For the design rationale and the history of earlier topologies (LSH buckets,
v1–v2; whole-core replication, v3–v4) see
[SEMANTIC_ROUTING.md](SEMANTIC_ROUTING.md). For tunables see
`src/core/config/MatchingConfig.ts` and `src/core/config/RoomConfig.ts`.

---

## 1. Publish path — when you write a post

```
text of the post  (≤ RoomConfig.maxPostChars)
   │
   ▼  EmbeddingGemma-300M (QVAC worker), "task: clustering | query: {text}"
embedding: Float32Array(768), L2-normalised
   │
   ▼  canonicalDigest(body) → Ed25519 sign            src/core/posts/CreatePost.ts
SignedRecord { author, body, digest, signature }
   │
   ▼  mailbox.append → Bare worker 'append' RPC        bare/p2p.mjs
record appended to the peer's own outbox Hypercore (feedIndex stamped)
   │
   ▼  worker derives the ANNOUNCEMENT from the record
{ author, outboxKey, feedIndex, kind, createdAt, embedding (full f32), digest }
   │
   ▼  gossiped to every connected peer on 'resonance-announce/v2'
   (compact-encoding binary, batched — re-forwarded transitively,
    reaches every peer in ~log₃₂(N) hops)
```

Key invariants:
- **No per-post routing decision.** The room was joined once at boot
  (`sha256(RoomConfig.topicPrefix + RoomConfig.networkSalt ||
  RoomConfig.roomId)`).
- **The body never travels with the announcement.** Peers receive the
  embedding (enough to rank) and the digest (enough to later verify); the text
  stays in the author's outbox until someone pulls it.
- **On boot the worker re-announces its own existing outbox** — announcements
  are in-memory, the outbox is durable, so a restarted node still tells the
  room about posts from earlier sessions.

Source: `src/core/posts/CreatePost.ts`, `bare/p2p.mjs` (`append`,
`announcementFromRecord`), `bare/announce-directory.mjs`.

---

## 2. Gossip path — how announcements reach everyone

Every connection multiplexes the `resonance-announce/v2` Protomux channel over
the Noise stream. On channel open each side sends the full set of
announcements it knows; afterwards only freshly-learned ones are forwarded.
Announcements travel as **compact-encoding binary** (~3.2KB for a 768-dim
post vs ~15KB as JSON text; codec in `bare/announce-codec.mjs`) and every
send is capped at `RoomConfig.announceBatchSize` announcements per message —
the snapshot grows with the room's history, and a single oversized frame
kills the connection at open (observed at 1063 announcements ≈ 15.6MB as
JSON). Dedup is by record address (`<author>:<feedIndex>`), which also makes
the flood loop-free. Connection fan-out is capped at
`RoomConfig.maxConnections` (32); transitive forwarding gives ~log₃₂(N)-hop
convergence.

The worker emits each freshly-learned announcement up to the app exactly once.
Because a peer can connect while the app is still booting, the app drains the
backlog right after registering its handlers via `network.rescan()` — the
worker re-emits its full known set, and ingestion is idempotent.

Source: `bare/announce-directory.mjs` (pure state machine),
`bare/p2p.mjs` (`onConnection`), `src/ui/AppContainerContext.tsx` (handler
registration + backlog drain) → `src/app-services/NetworkIngestion.ts`.

---

## 3. Receive path — two-tier ingestion

### Tier 1 — rank the announcement (cheap, runs for EVERY announcement)

```
announcement arrives ('announcement' event)
   │
   ▼  scoreAgainstOwn(embedding, own posts, About-you fallback)
similarity = MAX cosine vs the user's own post embeddings
   │
   ▼  decideAdmission(similarity, inbox count, weakest occupant)
   │        src/core/inbox/InboxAdmission.ts  (unchanged conf-9 rule)
   ├─ reject (below RoomConfig.inboxMinSimilarity, or loses to the weakest)
   │     └─ summary still recorded in Tier-1, no pull. Cost: a dot product.
   └─ admit / replace → shouldPull
         └─ summary recorded in Tier-1, pull requested
```

- Every announcement (admitted or not) is upserted into the **Tier-1 store**
  (`announcements` table, `src/data/AnnouncementRepository.ts`), capped at
  `RoomConfig.announceTier1Capacity` — lowest-scoring non-pulled rows are
  evicted first. Tier-1 is what re-ranking works over when the user's own
  profile changes.
- The announced embedding is **untrusted** at this point. The tentative
  admission only decides whether to spend a pull on it — nothing is stored in
  the inbox yet.
- Non-post records (responses, reactions) carry no embedding and are always
  pulled: they are tiny and thread-relevant.

Source: `src/core/inbox/IngestAnnouncement.ts`,
`src/core/inbox/ScoreAgainstOwn.ts`, `src/app-services/NetworkIngestion.ts`
(`handleAnnouncement`).

### Pull — fetch exactly one block (only for winners)

```
network.requestPull(author, feedIndex) → worker 'pull' RPC
   │
   ▼  open the author's outbox core (sparse — downloads nothing by itself)
   ▼  swarm.join(core.discoveryKey) + core.findingPeers()   ← locate a holder
   ▼  core.get(feedIndex, { wait, timeout: RoomConfig.pullTimeoutMs })
ONE block downloaded → full SignedRecord emitted to the app ('record' event)
```

Source: `bare/p2p.mjs` (`pull`). The sparse single-block semantic is proven by
`scripts/spike/sparse-pull.spike.ts`.

### Tier 2 — verify and commit (bounded, runs only for pulled records)

```
pulled record
   │
   ▼  validateRecordBody (text length, embedding dim)   ← untrusted-input caps
   ▼  canonicalDigest(body) == record.digest ?          ← integrity
   ▼  Ed25519 verify(digest, signature, author) ?       ← authenticity
   │
   ▼  RE-SCORE on the VERIFIED body embedding           ← closes S2:
   │     a lying announcement that won a tentative slot is dropped here
   │     if the real embedding does not earn it
   ▼  decideAdmission against the CURRENT inbox state
   ├─ admit    → posts.upsert, Tier-1 row marked `pulled`
   ├─ replace  → evict the weakest (its `pulled` flag CLEARS — it can win a
   │             future re-rank again), then upsert + mark `pulled`
   └─ reject   → dropped, Tier-1 row stays UNMARKED (the pull was spent,
                 nothing stored; a later basis change may pull it again)
```

`pulled` means "body **currently held** in Tier-2", not "downloaded once":
it is set only on a successful commit and cleared on eviction (replace and
the boot trim both clear it). Marking before the decision would burn every
evicted/rejected record forever — no re-rank could ever bring it back. A boot
self-heal (`resetOrphanedPulledPosts`) repairs flags left orphaned by a crash
between eviction and clear.

Responses and reactions skip scoring and land directly in their thread
projections (`responses` / `reactions` tables, with their per-author product
rules).

Source: `src/app-services/NetworkIngestion.ts` (`persistRecord`),
`src/core/inbox/IngestPulledPost.ts`,
`src/core/validation/ValidateRecordBody.ts`.

---

## 4. Re-ranking — when the user's profile changes

Similarity is a relationship between a post and the **receiver's own posts**,
so every new own post can change the score of every summary already seen.
After publishing:

1. The new own embedding joins the in-memory own-post set
   (`appendOwnEmbedding`).
2. The stored Tier-2 inbox is re-scored against the larger own-post set
   (`rescoreInboxAgainstOwnPosts`) so grouping stays correct.
3. `network.rescan()` re-emits every known announcement; each flows through
   Tier-1 ingestion again with the updated profile, and fresh winners are
   pulled. (`src/core/inbox/RerankAnnouncements.ts` implements the same pass
   as a pure batch, for callers that want it without the re-emit.)

Cold start: with no own posts and no "About you" text the interest profile is
null, every announcement scores `null`, and the bounded inbox rejects it —
nothing is pulled until the user writes a first post or sets their interests.

---

## 5. Cost model — what scales with what

| Cost | Scales with | Bound |
|---|---|---|
| Announcement traffic received | total posts in the room (~3 KB each) | network-level; the only O(N) term |
| Scoring (dot product, 768 dims) | one per announcement | microseconds each |
| Tier-1 storage | capped | `announceTier1Capacity` (5000) |
| Pulls + signature verifies | bounded by admissions | ~`inboxCapacity` + churn |
| Tier-2 storage (full posts) | capped | `inboxCapacity` (200) |
| Open remote cores | only those being pulled | transient |

The v3/v4 model paid download + verify + storage for **every record in the
room** and kept every remote core open; v5 pays them only for the bounded
admitted set. The remaining O(N) term — receiving every announcement — is the
price of exact global ranking; pushing past it (interest sharding, int8
announcements) is deliberately deferred until measurements demand it.

---

## 6. Observability cheatsheet

| Log line | Where | Meaning |
|---|---|---|
| `[p2p] re-announced N own outbox record(s) on boot` | worker | own history offered to the room |
| `[p2p] announce open, sent N announcements` | worker | snapshot sent to a new connection |
| `[p2p] learned N announcements (known=M)` | worker | fresh announcements received |
| `[p2p] pulled <author>:<i> kind=<k>` | worker | sparse single-block pull succeeded |
| `[p2p] pull failed <author>:<i>` | worker | no holder within `pullTimeoutMs` |
| `[rn] inbox admit/replace author=… similarity=…` | app | verified record committed to Tier-2 |
| `[rn] inbox drop … reason=reject-…` | app | verified record did not earn a slot |
| `[rn] persistRecord REJECTED … reason=…` | app | untrusted-input cap or integrity failure |

On Android the worker lines appear under the logcat tag `bare`, the app lines
under `ReactNativeJS`.
