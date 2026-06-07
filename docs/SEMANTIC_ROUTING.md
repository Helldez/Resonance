# Resonance — Semantic Routing

> **⚠️ Historical.** Resonance moved to a single shared Hyperswarm room with
> **announce-then-pull** (topic v5): lightweight signed announcements gossip
> globally, bodies are sparse-pulled only on admission into the bounded top-K
> inbox, with **no LSH, buckets, sticky peers or DHT routing table**. The
> semantic-routing design below is kept for context on *why* those mechanisms
> were tried and dropped (as was the v3–v4 replicate-every-core room that
> followed them). The current model is summarised in
> [AGENTS.md](../AGENTS.md) ("Matching conventions").

> **Looking for the current runtime flow (what happens when you publish or
> receive a post)?** That belongs in [MATCHING_FLOW.md](MATCHING_FLOW.md).
> This document keeps the **design rationale and history of decisions**.

How Resonance gets a post from its author to peers who are most likely to
care, without a central server. This document is the design rationale —
what is implemented today, what is deferred, and what the candidate next
steps are. It is the source of truth for the scaling hypotheses we keep
reopening in conversation.

If you are looking at code, the LSH routing described below **no longer
exists** — `src/core/matching/LshBucket.ts`, `InterestVector.ts` and
`ComputeListeningBuckets.ts` were removed in conf 9. The current single-room
implementation lives in `bare/p2p.mjs` + `bare/room-directory.mjs`, with
`src/core/inbox/InboxAdmission.ts` for the bounded inbox and constants in
`src/core/config/RoomConfig.ts`.

---

## 1. The problem we are trying to solve

> "In a pure P2P system you only see posts from peers you are directly
> connected to, or at most friends-of-friends. It is impossible to build
> an effective global 'Explore' page without a central server that
> indexes everything."

Resonance bets that this is not true if "similarity" is the routing key
instead of "who follows whom". Every node embeds its own posts on-device;
two strangers whose embeddings live near each other in semantic space
should be able to find each other without ever asking a central
authority who has what.

The whole document below is about how to make that bet survive contact
with the realities of a DHT.

---

## 2. Vocabulary

A few terms keep coming up. Pinning their meanings here avoids confusion
later.

- **Embedding**. A `Float32Array(256)` produced by EmbeddingGemma
  (768-dim Matryoshka truncated to 256) and L2-normalised. Two posts are
  "semantically close" iff the cosine of their embeddings is close to 1.
- **LSH (Locality-Sensitive Hashing)**. A family of hash functions where
  closeness in input space is preserved as closeness in hash space. We
  use signed random hyperplanes: pick `B` random vectors `h_1..h_B`, the
  LSH code of an embedding `x` is the bit string `[sign(x·h_i)]`. Two
  embeddings whose cosine is `c` agree on each individual bit with
  probability `1 - acos(c)/π`.
- **Bucket**. A short bitstring (currently 8 bits). It is the LSH code
  of an embedding, used as a topic identifier. The space has
  `2^B = 256` buckets today. All peers use the same seed
  (`MatchingConfig.lshSeed`) so the hyperplanes — and therefore the
  bucket assignment — are network-wide consistent.
- **Hyperswarm topic**. A 32-byte identifier used by Holepunch's
  Hyperswarm DHT to discover peers interested in the same content. We
  derive the topic from the bucket with `sha256("resonance/v1/" + bucketId)`.
- **DHT (Distributed Hash Table)**. A peer-to-peer key/value lookup
  service. Hyperswarm runs on top of HyperDHT, an open Kademlia-style
  DHT. Peer discovery is "who else announced interest in this topic?".
- **Hypercore**. An append-only signed log. Each peer's posts live in
  their personal Hypercore ("outbox"); other peers replicate it after
  exchanging keys.
- **Outbox key exchange**. When two peers connect, they swap the public
  keys of their outbox Hypercores over a multiplexed Protomux channel
  so Corestore can start replicating both directions.

When we say "topic" we always mean the Hyperswarm topic. When we say
"bucket" we mean the LSH code. The mapping `bucket → topic` is currently
1-to-1.

---

## 3. What ships today (Tier 1)

A single LSH code per peer, derived from one of two things:

1. The embedding of the user's posting history, aggregated. (Live posts
   override the About-you embedding once the user has written at least
   one post.)
2. As a cold-start fallback, the embedding of the user's About-you text,
   or `MatchingConfig.fallbackInterestText` if About-you is empty.

```
about_you OR latest_post  ──▶  embed  ──▶  lshBucketOf  ──▶  bucket (8 bits)
                                                              │
                                              sha256("resonance/v1/" + bucket)
                                                              │
                                                              ▼
                                                       Hyperswarm topic
                                                              │
                                                              ▼
                                                  Hyperswarm.join(topic)
```

Once joined:

- The Bare worker dials peers Hyperswarm hands it on that topic.
- Over each connection a Protomux directory channel is opened: each side
  announces its outbox public key.
- Corestore starts replicating both outboxes. Hypercore delivers every
  new block (i.e. every new signed record) to the receiver.
- The receiver re-derives the cosine similarity locally, scores against
  its own posting history, and surfaces the post in the inbox if the
  similarity passes `useSettingsStore.similarityThreshold`.

This is Tier 1. It is enough to validate the thesis on two devices, and
that is what the MVP ships with.

### What Tier 1 is good at

- Zero infrastructure. The DHT and the replication are entirely
  Holepunch.
- Single signal in, single signal out: the bucket id is fully determined
  by the embedding, and two peers in the same bucket *will* see each
  other's posts up to network reachability.

### Where Tier 1 cracks

Three failure modes show up at very different scales.

#### 3.1 The cliff problem (any scale)

LSH with `B` hyperplanes assigns two embeddings to the same bucket only
if they sit on the same side of *every* hyperplane. The agreement
probability per hyperplane is `1 - acos(cos_sim)/π`. With 8 hyperplanes
and `cos_sim ≈ 0.85` (genuinely close posts), the all-bits-match
probability is roughly `(1 - 0.18)^8 ≈ 0.20`. That is a 1-in-5 chance
that two near-neighbours land in the *same* bucket. The other 4-in-5
cases land them in buckets that differ in 1 or 2 bits.

Today we ignore those Hamming-1 buckets entirely. Two users whose
embeddings are extremely close, but who happen to fall on opposite sides
of one hyperplane, never meet. This is the most important known defect
of the current implementation. See Tier 2 below.

#### 3.2 The empty-bucket problem (small networks)

With 256 buckets and ~3 early test users, two devices land in the same
bucket only if their About-you texts overlap heavily. We currently work
around this manually in the two-device test by using a similar
About-you on both phones. For broader test cohorts, see Tier 2 again —
multi-table LSH compounds the effective number of "tries".

#### 3.3 The hot-bucket problem (large networks)

If a popular topic ("AI" today, "the election" next year) concentrates
many users into one bucket, that bucket becomes a small social network
of its own: every peer in it tries to replicate every other peer's
outbox. Hyperswarm caps each topic at ~64 connections per node by
default, so above that we are not *broken*, but we are no longer routing
by similarity — we are routing by who happened to dial first. See
Tier 3 and Tier 4 for the durable answers.

---

## 4. Hypotheses for "posts close to mine come from the right bucket"

This is the live discussion. We want, eventually, that for any post a
user composes, the peers who see it are exactly the peers whose
posting history is closest to that post in semantic space — not "in
roughly the same coarse bucket".

The candidate strategies are progressive: each one makes a different
tradeoff between implementation cost, latency, and routing quality. We
expect to implement them in order, gated on whether the previous tier
turned out to be insufficient.

### Tier 2 — Multi-table LSH and Hamming-1 neighbor join

**What it is.** Instead of one set of `B` hyperplanes, generate `L`
independent sets (`L` "hash tables"). A peer joins `L` buckets — one
per table. Two peers see each other if they collide in *any* table.

Probability of collision with `L` independent tables and per-table
probability `p`: `1 - (1 - p)^L`. With `B = 8`, `cos_sim ≈ 0.85`,
`p ≈ 0.20`, choosing `L = 8` raises the collision probability to about
`1 - 0.8^8 ≈ 0.83`. Choosing `L = 16` raises it to `≈ 0.97`. The cost
is `L`-times more Hyperswarm topics joined per peer, which is mostly a
DHT-announcement cost, not a connections-held cost (Hyperswarm only
holds active connections, not every topic it has ever announced).

**Hamming-1 join.** As a cheaper variant, keep one table but also
announce the `B` buckets that differ from yours by exactly one bit.
That gives `B + 1 = 9` topics per peer with `B = 8`. Per-pair recall is
weaker than multi-table LSH but it is essentially free.

**What it does not fix.** Hot buckets still concentrate connections.
The signal-to-noise inside any one bucket is unchanged.

**When to ship.** As soon as the Tier 1 cliff problem starts costing
the user surprise matches on a small test cohort. This is Phase 2 in
the roadmap.

### Tier 3 — Gossip top-K per peer

**What it is.** Each peer, in addition to (or instead of) replicating
*every* outbox in its bucket, maintains a top-K list of the K peers
whose embeddings are closest to its own. New posts are routed first to
that top-K set, then probabilistically gossipped on the bucket topic.

The top-K list is built incrementally: each time a new peer is
discovered (via the LSH topic or via someone else's gossip), the
receiver checks the cosine distance and, if it beats one of the current
K entries, evicts it. This is exactly the "small-world overlay on top
of a coarse hash" pattern that production P2P systems converge on.

**What it does fix.** Hot-bucket fan-out (you do not replicate
everyone, only top-K), and quality (top-K is finer-grained than any
fixed bucket).

**What it does not fix.** Discoverability at the long tail — peers
whose embedding is unusual still need *some* coarse mechanism to be
found in the first place. So Tier 3 is layered on top of Tier 1 or
Tier 2, not a replacement.

### Tier 4 — Direct semantic routing on the DHT (Semantica)

**What it is.** Skip the "bucket → topic → swarm" indirection
altogether. Use the embedding itself, or a fixed-length LSH projection
of it, as the *DHT node id*. Then routing a post becomes a Kademlia
lookup in semantic space: the post's embedding is the lookup key, and
the routing tree converges on peers whose ids (i.e. embeddings) are
closest to it.

This is the design proposed in *Semantica: Decentralized Search using a
LLM-Guided Semantic Tree Overlay* (Bornholdt et al., arXiv 2502.10151,
2025). They show that with on-device LLM embeddings and DHT-as-tree,
search and recommendation collapse into the same operation.

**What it requires.** A DHT whose node-id assignment we control. With
HyperDHT this is possible: a node id is just a 32-byte buffer.
**Critically, we must not sha256 the LSH bits before using them as a
node id** — the cryptographic hash is uniform on its output, which
*destroys* the locality property that made LSH worth doing. Use the LSH
bits (padded or extended deterministically) directly as the node id.

**What it gives us.** True semantic routing at log-N hop count, no
topics, no buckets. The "Explore" page becomes a one-liner: query the
DHT with the user's interest embedding as the key.

**What it costs.** The most ambitious of the four. Requires forking or
bypassing parts of `hyperdht`, careful attention to Sybil resistance
(an attacker who picks a target id can land arbitrarily close to any
user — Semantica discusses defences), and a new model of what
"announce" and "lookup" mean. Worth doing only after Tier 2/3 have
demonstrated the product hypothesis.

### Why not just increase `B`?

A reasonable instinct is: if 8 bits gives a noisy bucket assignment,
use 16 or 32. This trades the cliff problem for the empty-bucket
problem. With 32 bits the space has 4 billion buckets — two users land
in the same one only if their embeddings are essentially identical.
Without compensating with Hamming-`r` joins or multi-table LSH, raising
`B` makes the system more precise *and* unable to find any matches at
all. So the answer is "raise `B` *and* add `L` tables", which is
exactly Tier 2.

### Why not put the embedding directly in the topic?

We discussed this — it sounds appealing ("encode the meaning in the
key, then the DHT does the rest"). The problem is exactly the sha256
issue above. Hyperswarm hashes whatever you hand it as a topic, so
embeddings-as-topics inherit Hyperswarm's uniform-space topology, not
semantic-space topology. To put the embedding directly into the
network address, you have to control the DHT layer underneath
Hyperswarm — which is Tier 4.

---

## 5. Concrete scaling scenarios

These numbers are back-of-envelope; treat as orders of magnitude.

### 100 users

All four tiers are equivalent. The bottleneck is *getting two devices
in the same bucket at all*, not similarity quality inside the bucket.
Manual coordination (same About-you on two phones for testing) is fine.
The MVP target.

### 10 000 users

Tier 1 produces lumpy outcomes: buckets aligned with mainstream topics
(e.g. "tech", "parenting") get most of the traffic, niche buckets are
silent. The cliff problem starts costing real matches. Tier 2
(multi-table LSH) lifts recall on near-misses to >95% per pair without
needing per-peer state. Hyperswarm's 64-connection cap is comfortably
below where individual nodes saturate.

### 100 000 users

Hot buckets push past Hyperswarm's per-topic peer cap, so we are
silently dropping connection candidates and routing by who-dialed-first
rather than by similarity. Tier 3 (gossip top-K) becomes load-bearing:
each peer holds ~50 "best neighbours" and gossips on the bucket only as
a discovery mechanism. Tier 2 is a prerequisite (recall) and Tier 3
sits on top (precision + bounded fan-out).

### 1 000 000 users

Routing now needs to be O(log N), which is what Kademlia gives us *if*
the node-id space is the right space. Tier 4 (semantic DHT) is the
durable answer. Tier 3 still helps locally; Tier 2 becomes a fallback
for embeddings the semantic tree cannot reach.

---

## 6. Constraints that bind every tier

- **No central server, ever.** Not even for tier selection or for an
  initial bootstrap list — Hyperswarm's existing DHT bootstrap nodes are
  acceptable because they are public infrastructure, not Resonance's.
- **No upstream patches.** We use Holepunch as a library. If we ever
  need to fork (Tier 4 will probably require it), the fork must be
  small, public, and labelled as a sunset-on-upstream branch — same
  posture as the JarvisQ parakeet streaming patches.
- **All embeddings stay on-device.** Embeddings are personal data; the
  product position is that they never leave the phone except embedded
  in the signed record of a post the user explicitly chose to publish.
- **Determinism of the LSH seed.** A network-wide constant. Changing it
  partitions the network. Any future migration needs a versioned
  bucket-prefix scheme (the `resonance/v1/` literal in the topic
  derivation is the migration anchor).

---

## 7. Open questions

These are not yet decided.

- **About-you vs. own-posts as the bucket source.** We currently embed
  About-you once at boot and use that as the LSH input. A user who
  drifts in topic over time stays bucketed by their original
  About-you. The receiver-side similarity scorer already learns from
  the user's actual posts, but bucket *membership* does not. Likely fix:
  re-bucket on a rolling window of the user's recent posts.
- **Per-post bucketing vs. per-peer bucketing.** Should a post be
  published into the bucket of its *content* (so an unusually off-topic
  post reaches the right audience) or into the bucket of its *author*
  (so the social graph stays coherent)? Tier 4 dissolves this question;
  in Tier 1–3 we have to pick.
- **Tier 2 storage budget.** With `L = 8` tables and 8 bits each, each
  peer announces 8 topics. Hyperswarm announces are cheap but not free,
  and the DHT load is shared. We should measure before committing to
  `L`.
- **Sybil resistance in Tier 4.** Anyone can compute the embedding of
  anyone else's expected interests and join the corresponding DHT
  position. The Semantica paper proposes proof-of-work-on-content as a
  defence; we have not evaluated alternatives yet.

---

## 8. Decision log

| Date       | Decision                                                                                   |
|------------|--------------------------------------------------------------------------------------------|
| 2026-05    | Ship Tier 1 (single 8-bit LSH bucket, one Hyperswarm topic per peer) as the MVP.           |
| 2026-05    | Use sha256("resonance/v1/" + bucketId) as topic. Accept that this destroys locality at the topic layer — it is fine because the locality lives one level up, in the bucket id itself. |
| 2026-05    | Receiver-side scoring switches from About-you cosine to `max(cosine vs own posts)` with About-you as cold-start fallback. Fix for the "two phones with same About-you never matched" case. |
| 2026-05    | Add foreground service so Tier 1 actually works when the app is backgrounded — without it the "always-on P2P" promise is unenforceable. |
| 2026-05-27 | Ship the semantic map as Option A: a pure UI projection of locally-replicated records, no protocol change. PCA-2 on-device, react-native-svg renderer, anchor = just-published post. Display name stays local-only — no `v1 → v2` topic bump. See §9. |
| (planned)  | Promote to Tier 1.5 (compose-time per-post probe) if the map shows too few neighbours on the small-cohort test. |
| (planned)  | Promote to Tier 2 when the small-cohort test exposes the cliff problem.                    |
| (planned)  | Promote to Tier 3 when one bucket reliably exceeds ~40 concurrent peers in measurement.    |
| (planned)  | Evaluate Tier 4 only after both above tiers have shipped and a real user base exists.      |

---

## 9. Compose-time view (Option A, Phase 1)

The semantic map is a **UI projection** of the routing geometry that
Tier 1 has already built up locally. It changes nothing on the wire.

### What the map shows

After publishing a post the user lands on a starfield screen:

- The just-published post is the bright anchor near the origin.
- Up to `MatchingConfig.mapMaxCandidates` of the most recent
  non-self posts already in the local `posts` table become smaller stars,
  positioned by PCA-2 of the 256-dim embedding cloud.
- Star colour is interpolated by cosine similarity to the anchor; the
  similarity number itself is shown when the user taps a star.

### Why Option A

The alternative would be to *probe* extra Hyperswarm buckets at compose
time (Tier 1.5, §4) so the map can include peers whose posts the device
has not received yet. Option A defers that: the map is built from what
the device already has on disk, which means

- zero new protocol behaviour to verify on real devices,
- the routing layer is unchanged and remains the source of truth,
- the map *itself* will surface whether Tier 1's recall is good enough
  by being either rich or sparse on a real two-device run.

### Per-peer vs per-post bucketing — only the *display* anchor changed

§7 lists this as an open question. Phase 1 takes a narrow stance:

- **Routing** (which Hyperswarm topic the user joins) stays *per-peer*:
  the user's interest profile drives bucket membership.
- **Visualisation** (where the map centres) is *per-post*: the anchor is
  the embedding of the post the user just wrote.

If the small-cohort test shows that the map is mostly empty because the
user's post drifted out of their residence bucket, Tier 1.5 is the
incremental fix — same map, richer candidate set.

### Projection algorithm

`src/core/matching/Project2D.ts`. Deterministic PCA-2 via deflated power
iteration. Pure TypeScript, no platform imports, runs in the calibration
Node harness too. Roughly:

1. Centre the candidate set on the global mean.
2. Find the leading eigenvector of the covariance via power iteration
   (`MatchingConfig.mapPcaPowerIterations`).
3. Deflate, find the second.
4. Project all centred vectors onto those two axes, rescale to
   `[-1, 1]`.

Upgrade path: replace the body with a UMAP call inside the Bare worklet
without touching the screen or `GetMapCandidates`.

### Identity in the map

Display names are local-only. The user's own anchor renders with
`SettingsStore.displayName` (or fingerprint if empty); remote stars
render with the truncated public-key fingerprint. No `authorDisplayName`
field is added to `PostBody`, so the topic stays at `resonance/v1/` and
the network is not partitioned.

---

## 10. Sticky peers and authorNoiseKey direct routing (Phase 2)

### The problem this section solves

Tier 1 with a single bucket per peer (or even Tier 2 with L buckets)
has a *deliverability* hole that the *discoverability* layer cannot fix
by itself: once Alice and Bob have stopped sharing any bucket — because
one of them changed About-you, drifted to a different post-driven
centroid, or simply rotated to a new bucket as part of post-driven
re-bucketing — the Hyperswarm topic connection between them dies.
Records still in Alice's outbox that Bob has not yet replicated are
stranded. Future responses Bob writes to one of Alice's posts cannot
reach her.

Empirically this happens within hours of two users having different
posting cadences. It is the difference between "we can find each
other" and "we can keep talking after we found each other".

### Two complementary mechanisms

#### 10.1 Sticky peers (persistent noise-key dial)

Hyperswarm exposes a `joinPeer(noisePublicKey)` API that maintains a
direct DHT connection to a specific peer regardless of which topics
either side currently announces. Resonance uses this to keep
already-established conversations alive:

1. The Bare worker persists the Hyperswarm `keyPair` to
   `<corestoreDir>/swarm-keypair.json` so the device's noise identity
   is stable across restarts. Without this, every restart would
   generate a new noise key and no peer could ever re-find the device.
2. On every peer connection, the bare worker emits a `peerNoise` event
   pairing the remote outbox key with the remote noise key.
3. The RN side persists those pairings in `peers.noise_pubkey`.
4. At boot, after joining the personal L buckets, the RN side restores
   every known peer's noise key and calls `swarm.joinPeer(...)` on
   each. Hyperswarm/HyperDHT then maintains those connections in the
   background, sharing the device's per-peer connection budget
   (`maxPeers`) with bucket-discovered peers.

Effect: a conversation between Alice and Bob, once started, continues
to be replicated even after their bucket sets stop overlapping. The
LSH layer becomes a pure discovery primitive; persistence is moved to
direct peer routing.

#### 10.2 `authorNoiseKey` in the signed PostBody

Sticky peers solve the case where a connection was once alive. They do
not solve the case where Bob downloaded Alice's post indirectly
(through a third peer's relayed replication) and never directly
connected to Alice — Bob has no noise key for Alice.

The fix is to ship Alice's noise key *inside the post itself*:

```ts
interface PostBody {
  // ...
  authorNoiseKey?: string;  // hex of Alice's Hyperswarm noise pubkey
}
```

The field is part of the canonical signed bytes (`CanonicalRecord`),
so Bob can verify that the noise key really came from Alice and was
not injected by a relayer. When Bob writes a response, the RN side
looks up `post.authorNoiseKey`, calls `swarm.joinPeer(noiseKey)`, and
the direct DHT dial completes — regardless of whether Bob and Alice
have ever shared a bucket.

This is the cleanest decomposition of the routing problem:

- **Discoverability** — "how does anyone find Alice in the first
  place?" — handled by Tier 2 multi-table LSH on Alice's *current*
  interest vector.
- **Deliverability** — "how does Bob reach Alice once he has one of
  her posts?" — handled by the noise key embedded in every post Alice
  publishes from this point forward.

### Backward compatibility

`authorNoiseKey` is canonicalised only when present, so pre-existing
posts (older databases, replicated records from peers on a build that
predates this change) still validate. New posts get the field; old
posts continue to work via the per-bucket discovery path alone.

### Limits

- The noise key embedded in a post is the device's noise key *at the
  time of publication*. If the user clears app data and a new noise
  key is generated, old posts still reference the dead key. No way to
  retroactively update old posts (Hypercore is append-only). Future
  remedy: an explicit "key rotation" record kind that current devices
  can publish to advertise their new noise key.
- A noise key in a post is public. This is already the case for the
  Ed25519 author pubkey, so the marginal privacy impact is zero, but
  it does mean that anyone with a copy of any of your posts can dial
  you on the DHT. Hyperswarm's `maxPeers` cap and the per-peer
  connection budget protect against floods; an attacker who acquires a
  popular post can attempt to fill the author's connection slots.
  Mitigation: bound the inbound connection budget and prefer
  connections to peers we have records from.

### Decision log row

| Date       | Decision                                                                                   |
|------------|--------------------------------------------------------------------------------------------|
| 2026-05-27 | Persist Hyperswarm keypair (stable noise identity), persist known peer noise keys, joinPeer at boot. Sticky-peers without an explicit "follow" UI. |
| 2026-05-27 | Embed `authorNoiseKey` in `PostBody`, canonicalised only when present (backwards compatible). Future posts are point-to-point reachable regardless of bucket overlap. |

---

## 11. Tier 2 ship status

Tier 2 is no longer "planned". `MatchingConfig.lshTables = 8` and
`MatchingConfig.lshSeeds = [...]` are live. Each peer announces in
8 topics derived from L independent hyperplane families, and the union
of per-table collisions drives bucket co-membership.

Post-driven re-bucketing is also live: once a user has at least
`MatchingConfig.postDrivenMinOwnPosts` own posts, the interest vector
that feeds the L LSH tables switches from `receiverContext` (About-you)
to the L2-normalised centroid of their most recent
`MatchingConfig.postDrivenWindow` post embeddings. The bucket re-join
is diff-based: only the (typically 1-2 of L) tables whose bucket bits
actually changed see a leave/join cycle, so connection churn is
bounded.

The §4 Tier 2 description above remains the authoritative analysis of
why this combination is the right answer for ~10k-scale networks.
