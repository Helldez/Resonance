# Resonance — Matching Flow (operational baseline)

> **⚠️ Superseded by the single-room "Keet model" (ResonanceSim conf 9).**
> The LSH/bucket routing described in the body below is **no longer the
> implementation**. The current model: every node joins **one shared
> Hyperswarm room**, peer outbox keys gossip transitively
> (`bare/room-directory.mjs`) so every post reaches every peer, and each
> device keeps a **bounded top-K inbox** (`src/core/inbox/InboxAdmission.ts`,
> capacity/threshold in `src/core/config/RoomConfig.ts`). Embeddings are
> **EmbeddingGemma-300M, 768-dim**, with the `task: clustering | query: {text}`
> prompt. Publishing is just embed → sign → append; receiving scores MAX
> cosine vs own posts and admits into the bounded inbox. The authoritative
> summary lives in [AGENTS.md](../AGENTS.md) ("Matching conventions"). The
> sections below are retained for historical context only.

This document describes **what actually happens at runtime** when a peer
publishes a post and when another peer receives one. It is the baseline for
every future optimisation: any change to throughput, recall, privacy, or
battery has to be argued against this concrete flow, not against an abstract
"P2P + LSH" model.

For the design rationale and history of decisions see
[SEMANTIC_ROUTING.md](SEMANTIC_ROUTING.md). For matching parameters see
`src/core/config/MatchingConfig.ts` and `src/core/config/RoomConfig.ts`.

---

## 1. Publish path — when you write a post

```
text of the post
   │
   ▼  bge-m3 (QVAC worker, llamacpp-embedding plugin)
embedding: Float32Array(1024), L2-normalised
   │
   ▼  lshBucketOf(embedding, lshSeed)            ← SINGLE seed, single bucket
bucket_id  e.g. "e3"   (lshBits=8 → 1 of 256 possible ids)
   │
   ├─→ inlined into the signed PostBody (so receivers know where it lives)
   │
   ▼  network.joinBucket("e3")
subscribe to Hyperswarm topic = sha256("resonance/v2/bucket/e3")
   │
   ▼  network.publish(record)
record appended to the user's personal Hypercore feed
+ replicated to every peer currently joined to topic "e3"
```

Key invariant: **a post lives in exactly one bucket**, ever. No duplicate
replicas across buckets. The bucket id is the "canonical home" of the post.

Source: `src/core/posts/CreatePost.ts`.

---

## 2. Listen path — which buckets you subscribe to

You do NOT only listen on the buckets where your own posts live. The full
recipe combines two anchors:

```
last N=10 own posts → for each → lshBucketOf(post, lshSeed)
   │
   ▼ dedup (preserve order)
example:  [e3, e3, 7a, e3, 1c, 7a, 2f, e3] → distinct = [e3, 7a, 1c, 2f]
   │
   ▼ if distinct.length < lshTables (8) → fill with centroid multi-table
centroid(last 10 own posts) → lshBucketsOf(centroid, lshSeeds[0..7])
   → 8 multi-table buckets, namespaced "t00-...".."t07-..."
   │
   ▼ append to distinct until length == 8 (skip ones already present)
final:  [e3, 7a, 1c, 2f, t00-9b, t01-44, t02-d8, t03-12]
```

Cold start (zero own posts): bucket = `lshBucketOf(aboutYou, lshSeed)` + up
to 7 fill buckets from `lshBucketsOf(aboutYou, lshSeeds[0..7])`.

Result: you subscribe to exactly `lshTables = 8` Hyperswarm topics, the same
network cost as the previous centroid-only design.

Source: `src/core/matching/ComputeListeningBuckets.ts`,
`src/ui/AppContainerContext.tsx` (`rebucketAndJoin`).

Why this shape — design rationale:

- **Per-post anchors** give symmetry with publishing: a peer who wrote
  something on a topic you care about probably published in a bucket near
  one of yours, so you naturally meet them in that bucket. The centroid
  alone could land in semantically empty space when your interests are
  multi-topic (the "average of A, B, C is in the middle where nobody lives"
  problem).
- **Centroid fill-up** restores classical LSH multi-table recall (≈83% at
  cos_sim 0.85 with 8 tables) for the mono-topic user whose own posts all
  collapse to 1-2 distinct buckets. Without it, that user would only have
  the single-table recall (≈20%) on their one topic.

---

## 3. Receive path — when a peer's post arrives

```
remote peer publishes a post in bucket "e3"
   │
   ▼ Hyperswarm DHT
any peer joined to "e3" establishes a direct P2P connection
(see "thousands of peers" below for the cap)
   │
   ▼ Hypercore replication
the signed record arrives (signature + body + 1024-dim embedding)
   │
   ▼ verify Ed25519 signature
   (mismatch → silently dropped, never persisted)
   │
   ▼ scoreRemotePost
sim = MAX(cosine(remote_embedding, own_post_embedding_i))
      for every i in ALL own posts (no time window, no decay)
   (cold start fallback: cos vs About-you embedding)
   │
   ▼ INSERT INTO posts (..., similarity=sim) in SQLite
   │
   ▼ UI inbox query filters: WHERE similarity >= user_threshold
   ▼ map / thread screens read the same SQLite projection
```

The receive-time score also records **which own post produced the MAX**
(`matched_own_address`), so the inbox can group each remote post beneath the
own post it most resembles.

Update: the `similarity` value is computed at receive time, but it is **no
longer frozen forever**. Publishing a new post triggers
`rescoreInboxAgainstOwnPosts` (`src/ui/AppContainerContext.tsx`), which
recomputes `similarity` and `matched_own_address` for every stored remote
post against the now-larger set of own posts. This keeps grouping correct and
resolves the cold→warm transition (old About-you-based scores are rewritten
on the same metric the inbox eviction uses).

Source: `src/ui/AppContainerContext.tsx` (`persistRecord`,
`scoreRemotePost`).

---

## 4. "What about thousands of peers in the same bucket?"

A legitimate concern, especially when reasoning about hot buckets where
many people happen to write about the same trending topic.

### 4.1 Hard cap — current state vs intended state

**Current (actual) behaviour.** `NetworkConfig.maxConnectionsPerBucket = 32`
is declared but **not passed to Hyperswarm** by `bare/p2p.mjs` (the
`swarm.join(topic, { server: true, client: true })` call uses no
`maxPeers` option). The effective limit today is therefore the Hyperswarm
default (`maxPeers` swarm-wide, not per-bucket), and the policy that
decides which peers occupy the slots is **first-come-first-served** —
both inbound (peers connecting to you to read your posts) and outbound
(you reaching peers in joined topics) compete for the same single,
bidirectional budget. If 5000 peers are joined to `"e3"`, you see
whichever ones the DHT happens to surface first; Hyperswarm rotates over
time but does not rank them by relevance.

**Intended behaviour.** Slot allocation must be **driven by semantic
affinity, not arrival order**. When a new candidate peer is discovered
(inbound or outbound) and the budget is full, the policy compares its
recent posts (or a centroid it ships in the handshake) against the local
peer's interest vectors, and **evicts the lowest-affinity occupant in
favour of the higher-affinity newcomer**. Effect: the 32-ish slots
converge to "the peers whose content is most similar to mine right now",
which is the actual product requirement. First-come is only a fallback
while the budget is still cold and below cap.

This change is policy-only — same transport, same Hyperswarm — but it
needs (a) per-peer affinity scoring at connection time, (b) an explicit
eviction hook, and (c) a tie-breaker for symmetry (both peers should
prefer to keep the connection, otherwise the loser keeps re-dialling).

### 4.2 Why this matters even at MVP scale
Without affinity-based eviction, the peers who write the most popular
content saturate their inbound budget first and lose the ability to do
outbound discovery — the "popular peer is mute" failure mode. With it,
both directions self-organise toward the same goal: each peer ends up
connected to the ~32 most semantically similar peers reachable through
the joined buckets.

### 4.3 Where this breaks at scale
If a bucket becomes truly dense (>1000 peers actively publishing):

- **Bandwidth**: full Hypercore feeds from 32 connected peers → megabytes
  per peer × 32. Does not scale to hundreds of new posts/day per peer.
- **CPU**: every incoming post runs cosine against all your own posts. With
  1000 own posts + 1000 incoming/day on 1024-dim, that is 1M dot products
  per day. Manageable on mobile but not free.
- **Mitigation paths** (deferred):
  - Bump `lshBits` from 8 to 12 → total buckets 256 → 4096 → average
    density per bucket /16. Network topology splits more finely. Network
    constant, requires `topicPrefix` v2 → v3.
  - Time-decay or sliding window on the score computation (cap MAX to last
    N own posts, or weight by recency).
  - HNSW only above ~10k local stored posts (not before — see
    SEMANTIC_ROUTING.md §8.x).

---

## 5. Optimisation surface — where to push

Use this section as the menu when discussing performance work.

| Lever | Effect | Cost | Network-breaking? |
|---|---|---|---|
| Bump `lshBits` (8→12) | Splits hot buckets 16× | Re-bucket migration, more topics joined | Yes (bump topicPrefix) |
| Bump `lshTables` (8→16) | Higher per-pair recall | Doubles topic subscriptions per peer | Yes |
| Per-post listening window (10→N) | More own-post anchors, broader interest coverage | More dedup work, possibly less fill | No |
| Score time-decay | Inbox stays focused on recent interests | Computational, plus need to re-score on threshold | No |
| Periodic re-score of remote posts | Sim adapts to new own posts | Batch CPU per new own post | No |
| Mean-centering of embeddings | Restores absolute cosine interpretation | Network constant (the mean vector) | Yes (bump topicPrefix) |
| Different embedding model | Different anisotropy profile, dim, language coverage | Re-embed everything | Yes |
| HNSW over local posts | O(log N) instead of O(N) inbox-scoring | Native dep build, index maintenance | No |
| K-means on listening anchors (K=2-3) | Better coverage when interests are clustered | k-means cost on rebucket, more topics | Maybe (depends on K) |
| Drop `maxConnectionsPerBucket` (32→...) | More peer-discovery, more bandwidth | Battery, file descriptors | No |
| Affinity-based connection slot policy (replace FCFS) | Slots converge to top-N semantically similar peers, inbound+outbound | Per-peer affinity scoring at connect time, eviction hook, symmetric tie-breaker | No |

Rule of thumb: anything in column 4 = "Yes" must bump
`NetworkConfig.topicPrefix` and ship `PostRepository.dropIfDimChanged` (or a
similar migration) to clear stale state.

---

## 6. Where the values come from

| Constant | File | Role |
|---|---|---|
| `embeddingDim: 1024` | `MatchingConfig.ts` | Native dim of bge-m3, kept full (no Matryoshka) |
| `lshBits: 8` | `MatchingConfig.ts` | Bits per bucket id (→ 256 buckets per table) |
| `lshTables: 8` | `MatchingConfig.ts` | Independent LSH tables for the fill-up step |
| `lshSeed`, `lshSeeds[]` | `MatchingConfig.ts` | Hyperplane families, network-wide constants |
| `postDrivenWindow: 10` | `MatchingConfig.ts` | Sliding window of own posts driving listening + centroid |
| `thresholdPresets` | `MatchingConfig.ts` | Inbox cosine thresholds users select in Settings |
| `mapReferenceRings.similarities` | `MatchingConfig.ts` | Map rings drawn (aligned to threshold presets) |
| `topicPrefix: "resonance/v2/bucket/"` | `NetworkConfig.ts` | Network version namespace |
| `maxConnectionsPerBucket: 32` | `NetworkConfig.ts` | Hyperswarm per-topic concurrency cap |

---

## 7. Quick observability cheatsheet

Every routing decision is logged with the `[rn]` prefix (works on both
React Native console and Electron DevTools console):

- `[rn] createPost bucket=<id> textLen=<n> embDim=<d>` — own post published
- `[rn] rebucket perPostRaw=N perPostDistinct=M filled=K source=<kind>` —
  listening recompute, with diagnostic source one of:
  `per-post-only`, `per-post-plus-centroid-fill`, `about-you-plus-fill`,
  `about-you-only`, `none`
- `[rn] rebucket buckets=<comma-separated>` — final set joined
- `[rn] rebucket diff leaving=<n> joining=<m>` — what changed vs previous
- `[rn] join bucket=<id>` / `[rn] leave bucket=<id>` — actual swarm churn
- `[rn] persistRecord enter author=... feedIndex=... kind=...` — incoming
- `[rn] scoreRemotePost source=own best=<sim> bestIndex=<i> ownCount=<n>`
  — similarity decided against own posts
- `[rn] scoreRemotePost source=about-you value=<sim>` — cold start path
- `[rn] persisted post address=... similarity=...` — final stored row

Settings screen exposes the current `getCurrentBuckets()` list and the
current `getCurrentBucketSource()` kind, so a non-dev user can see whether
they are in `per-post-only` regime, cold start, etc.
