# Resonance — Complete Guide

A front-to-back walkthrough of **what Resonance is** and **how it's built**. It
starts simple and functional, then goes deep on the two parts that make the app
tick: the **peer-to-peer (P2P) layer** and the **on-device AI-agent layer**.

This guide stitches together the existing specs and points back to them for detail:
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`AGENTS_FLOW.md`](AGENTS_FLOW.md),
[`MATCHING_FLOW.md`](MATCHING_FLOW.md), [`SEMANTIC_ROUTING.md`](SEMANTIC_ROUTING.md),
[`DESKTOP.md`](DESKTOP.md), [`ROADMAP.md`](ROADMAP.md), [`STATUS.md`](STATUS.md),
and the contributor rules in [`../AGENTS.md`](../AGENTS.md).

---

## Part 0 — TL;DR

**Resonance is a local-first, server-less social network where posts find the right
people by meaning, not by an ad algorithm.** Every device runs a small embedding
model and a small LLM locally, and joins one shared peer-to-peer "room". When you
post, your text is turned into a 768-number *embedding* (a fingerprint of its
meaning), signed with your private key, and gossiped across the network. Every other
device scores your post against what *its* owner cares about and keeps it only if
it's relevant. There is no server, no account, no cloud, and no telemetry. An
optional on-device **AI agent** can read your inbox and react, reply, or post on
your behalf — but only inside hard limits you set, and only after deterministic
"governor" code approves each action.

```
                YOU POST "best way to learn rust?"
                              |
              [embed on-device] -> 768-dim vector
                              |
              [sign with your Ed25519 key]
                              |
              [append to YOUR append-only feed]
                              |
              [gossip a signed ANNOUNCEMENT          ... Hyperswarm room "global"
               {embedding + digest} — not the text]
                              |
        +---------------------+----------------------+
        v                     v                      v
     Peer A                Peer B                 Peer C
   scores the           scores the             scores the
   announcement         announcement           announcement
   sim 0.71 -> PULL     sim 0.12 -> DROP       sim 0.55 -> PULL
        |               (never downloads it)       |
   downloads JUST that block, verifies it,    same
   shows in their inbox
        |
   they (or their agent) reply -> comes back to you the same way
```

---

## Part 1 — Functional level (the simple picture)

### 1.1 What problem it solves

Mainstream social apps route attention through a central server and an opaque ranking
algorithm tuned for engagement. Resonance asks a different question: *if every phone
can run an embedding model and an LLM, and every phone can talk directly to every
other phone, can a message find the right reader by sheer relevance — no server, no
ads, no account?* That's the whole thesis. Relevance is computed **on your device**,
about **your** interests, and nobody else decides what you see.

Privacy here is a **constraint, not a feature**: there is no backend that *could*
collect data, because there is no backend at all.

### 1.2 The app, screen by screen

All screens live under `src/app/` (Expo Router). The shell is a four-tab
layout (`(tabs)/`: Home, Atlas, Agent, You) with pushed screens on top;
first run goes through a four-step onboarding (`src/ui/onboarding/`):

| Screen | File | What the user does |
|---|---|---|
| **Onboarding** | `src/ui/onboarding/OnboardingFlow.tsx` | First launch: welcome, identity + display name, "About you", agent opt-in + LLM download — while the container boots in the background (`src/ui/Splash.tsx` shows the boot checklist otherwise). |
| **Home** | `app/(tabs)/index.tsx` | The timeline — your posts anchoring their resonances, plus "Based on your interests". Compose FAB. Auto-refreshes. |
| **Compose** | `app/compose.tsx` | Write and publish a post (modal). |
| **Atlas** | `app/(tabs)/atlas.tsx` | A 2-D "topic atlas" of posts (UMAP projection of the embeddings, PCA-2 fallback for small sets) grouped into named topics — see your semantic neighborhood. |
| **Thread** | `app/thread/[id].tsx` | Open a post, read its replies/reactions, write or AI-draft your reply in the sticky composer. |
| **Agent hub** | `app/(tabs)/agent.tsx` | Everything the agent is and does: the autonomy dial, today's stats, drafts awaiting approval (inline approve/dismiss), and the live activity timeline. The tab badge counts pending approvals. |
| **Agent settings** | `app/agent-settings.tsx` | Configure the agent: name, tone, interests, goals, daily limits, advanced thresholds, kill switch. |
| **You** | `app/(tabs)/you.tsx` | Your identity (avatar, fingerprint, display name), your own posts, and the door to Settings. |
| **Settings** | `app/settings.tsx` | Profile (display name, "About you"), similarity threshold, AI model management. |

### 1.3 The three flows that matter

**Flow A — Publishing a post**

```
type text
   -> embed locally (EmbeddingGemma, 768 dims, L2-normalized)
   -> wrap as a PostBody {text, embedding, createdAt}
   -> hash it (SHA-256) and sign the hash (Ed25519)
   -> append the signed record to YOUR append-only feed (a "Hypercore")
   -> the worker derives an ANNOUNCEMENT {author, embedding, digest} and
      gossips it to the room — the text stays in your feed until pulled
```
You don't "send to a server." You append to your own log and announce it;
peers that find it relevant pull that one block from you.

**Flow B — Receiving & the two-tier inbox (announce-then-pull)**

```
incoming ANNOUNCEMENT from a peer   (embedding + digest, no text — cheap)
   -> score it:
        if you have your own posts:  similarity = MAX cosine(ann, each of your posts)
        else (cold start):           similarity = cosine(ann, your "About you" text)
   -> decide admission (bounded top-K, conf 9):
        sim < 0.30 (threshold)?           -> reject (summary kept in Tier-1, no download)
        inbox has < 200 entries?          -> admit  -> PULL
        inbox full, sim > weakest entry?  -> replace -> PULL
        otherwise                         -> reject (full)
   -> PULL: sparse-download exactly that one block from the author's feed
   -> verify the digest + Ed25519 signature   (mismatch -> DROP, never stored)
   -> RE-SCORE on the verified embedding      (a lying announcement dies here)
   -> commit to the inbox (or drop if the real embedding doesn't earn it)
```
Your inbox is a **bounded top-K of size 200** ranked by how close posts are to what
*you* write about, plus a **Tier-1 store of up to 5000 announcement summaries**
used for ranking and re-ranking. Only the 200 winners ever cost a download,
a signature check, or body storage. Your own posts and responses are kept
separately and never count against either budget.

**Flow C — The AI agent's turn (one "tick")**

```
PERCEIVE  -> look at up to 6 recent inbox posts you haven't handled
TRIAGE    -> LLM: "is this relevant to my user?" score 0..1 (need >= 0.55)
DECIDE    -> LLM: react / respond / do nothing?  (react is the default)
GOVERN    -> deterministic code: under daily caps? not a duplicate? not on the
             "never" list? kill-switch off? session budget left?
ACT       -> publish the reaction/reply/post through the SAME code a human uses
REMEMBER  -> bump counters, record the output for dedup, write to the activity log
```
The LLM only ever *proposes*. A plain, auditable **governor** is the only thing that
authorizes a write.

### 1.4 Glossary

- **Peer** — another device running Resonance. Identified by its public key.
- **Room** — the single shared Hyperswarm topic everyone joins (`"global"`).
- **Outbox / Hypercore** — your personal append-only, signed log of posts/responses/reactions. The source of truth.
- **Embedding** — a 768-number vector that captures the meaning of a piece of text.
- **Similarity** — cosine distance between two embeddings (1 = identical meaning, 0 = unrelated).
- **Inbox** — your local, relevance-ranked, size-200 cache of *other people's* posts.
- **Reaction** — a lightweight signed acknowledgement. Currently a single `like` (the type stays in the signed body, so the wire format can carry more kinds later without a network bump).
- **Autonomy mode** — `off` / `suggest` / `autopilot`: how much freedom the agent has.
- **Governor** — deterministic rule engine that approves or blocks every agent action.

---

## Part 2 — Architecture (who does what)

### 2.1 Hexagonal layering

Resonance is built as **ports & adapters (hexagonal architecture)**. The core domain
logic is pure TypeScript that knows nothing about React Native, Electron, or Bare — it
only talks to abstract *ports*. Platform-specific *adapters* plug in at the edges. This
is what lets the same logic run inside a phone, inside Node, or inside a calibration
script.

```
        +-------------------------------------------------+
        |  src/app  (Expo Router screens)  +  src/ui      |   <- presentation
        +-------------------------------------------------+
        |  src/domain  (Zustand stores, UI domain types)  |
        +-------------------------------------------------+
        |  src/core   PURE TYPESCRIPT, imports ONLY ports  |  <- the hexagon
        |  posts / inbox / responses / reactions / agent   |
        |  config / domain types / utils                   |
        |        |  depends on  |                           |
        |        v              v                           |
        |   src/core/ports/*  (interfaces only)            |
        +-------------------------------------------------+
        |  src/data  (SQLite-backed repositories)          |  <- projection
        +-------------------------------------------------+
        |  src/platform/mobile   |   src/platform/desktop  |  <- adapters
        |  Expo + RN + Bare      |   Node + Electron + Bare |
        +-------------------------------------------------+
```

**Golden rule:** `src/core/**` imports only from `src/core/ports/*` and plain TS. It
never touches Expo, React Native, Bare, or Electron. See [`../AGENTS.md`](../AGENTS.md)
for the enforced boundaries.

### 2.2 Ports & their adapters

| Port (`src/core/ports/`) | Responsibility | Mobile adapter | Desktop adapter |
|---|---|---|---|
| `IEmbeddingService` | text → 768-dim vector | `QvacEmbeddingService` | (re-uses mobile) |
| `ILlmService` | prompt → completion | `QvacLlmService` | (re-uses mobile) |
| `IDatabase` | SQL query/exec/transaction | `ExpoSqliteDatabase` | `NodeSqliteDatabase` (`node:sqlite`) |
| `IKeyValueStore` | get/set small values | `AsyncStorageKv` | `NodeKvStore` (JSON on disk) |
| `IIdentity` | Ed25519 generate/sign/verify | `Ed25519Identity` (@noble) | (re-uses mobile) |
| `IFileSystem` | read/write app data | `ExpoFileSystem` | `NodeFileSystem` (bare-fs) |
| `IClock` | `now()` | system clock | system clock |
| `ILogger` | structured logging | console | console |
| `IMailbox` | append to my Hypercore | `shared/P2pMailbox` (both targets) | (same) |
| `IPeerNetwork` | join room, publish, receive, presence | `shared/P2pNetwork` (both targets) | (same) |

> Note on the desktop SQLite adapter: it uses Node's **built-in `node:sqlite`** rather
> than a native addon — this fixed a breakage under Node 24 (no native build step).

### 2.3 Runtime targets & entry points

- **Android (primary, the MVP target):** `src/app/_layout.tsx` boots Expo Router;
  `src/platform/mobile/bootstrap.ts → bootstrapMobile()` builds the dependency-injection
  container and wires every adapter. The Bare P2P worker is mounted via
  `react-native-bare-kit`. A foreground service
  (`plugins/with-foreground-service.js`) keeps replication alive in the background.
- **Desktop (secondary, for testing without a second phone):**
  - Headless CLI: `npm run desktop:peer` → `scripts/desktop/peer.ts → bootstrapDesktop()`,
    a REPL with `publish <text>`, `peers`, `exit`. See [`DESKTOP.md`](DESKTOP.md).
  - Electron shell: `electron/main.cjs` spawns the headless peer as a child process and
    bridges it to a renderer. Full UI wiring is still in progress.

### 2.4 Data model — SQLite is a *projection*, Hypercore is the truth

The authoritative records live in append-only Hypercore feeds (in the Bare worker).
SQLite is a fast, queryable **projection** of what's been received, rebuilt from the
feeds. Repositories live in `src/data/`:

| Repository | Table | Role |
|---|---|---|
| `PostRepository` | `posts` | remote posts: `address` (PK), `author`, `feed_index`, `text`, `embedding` (BLOB), `created_at`, `similarity` |
| `ResponseRepository` | `responses` | replies, keyed by `in_reply_to` |
| `ReactionRepository` | `reactions` | one per `(author, in_reply_to)`, newest wins |
| `PeerRepository` | `peers` | discovered peer keys |
| `AgentActivityRepository` | `agent_activities` / `agent_skipped` | action counters, dedup ledger, terminally-skipped candidates |
| `PendingActionRepository` | `pending_actions` | suggest-mode drafts awaiting approval |
| `AgentLogRepository` | `agent_log` | the human-readable activity stream |

On model swap, `PostRepository.dropIfDimChanged(dim)` wipes stored posts if the
embedding byte-length no longer matches — so changing the embedding model can't corrupt
similarity math.

### 2.5 npm scripts

| Script | What it does |
|---|---|
| `npm start` | Expo dev server (QR for phone) |
| `npm run android` | build + install the APK |
| `npm run prebuild` | generate native `android/` project |
| `npm run typecheck` | `tsc --noEmit`, strict TS |
| `npm test` | pure-function tests: inbox admission + topics |
| `npm run calibrate` | M0 gate: evaluate embedding quality on a corpus |
| `npm run build:bare` | bundle `bare/p2p.mjs` → `bare/p2p.bundle.mjs` (mobile) |
| `npm run build:bare:desktop` | bundle the desktop variant |
| `npm run desktop:peer` | headless desktop peer REPL |
| `npm run electron:dev` | Electron shell |

---

## Part 3 — Deep dive: the P2P layer

This is where Resonance differs most from a normal app. There is no API; there is a
**gossip network of append-only logs**.

### 3.1 The stack

From `package.json`:

- **hyperswarm** — DHT-backed peer discovery + encrypted (Noise) connections.
- **corestore** — manages many Hypercore feeds locally and auto-replicates them over any stream.
- **hypercore** (with **hyperdb** / **hyperdrive**) — the append-only signed log primitive.
- **protomux** — multiplexes several logical protocols over one connection.
- **compact-encoding** — compact binary encoding for the gossip messages.
- **Bare** runtime + `bare-*` modules — a lightweight Node-like runtime that runs the
  same JS on a phone (via `react-native-bare-kit`) and on the desktop (as a subprocess).

### 3.2 One core, two hosts (how mobile & desktop share code)

The entire P2P + replication brain is a single file, **`bare/p2p.mjs`**. It runs
unchanged on both platforms; only *how it's hosted* and *how messages cross the
boundary* differ:

```
   MOBILE (Android)                         DESKTOP (Node/Electron)
   ----------------                         -----------------------
   React Native (Hermes)                    Node process
        |                                        |
        +--------- shared/P2pWorker.ts ----------+
        |    (one adapter, transport injected)   |
   WorkletTransport.ts                      SubprocessTransport.ts
        |  BareKit.IPC                            |  loopback TCP (127.0.0.1:port)
        v                                        v   (BARE_IPC_PORT env var)
   react-native-bare-kit                    BareSubprocess.ts -> `bare` binary
        |                                        |
        +------------- bare/p2p.mjs -------------+
                  (Corestore + Hyperswarm
                   + directory gossip + replication)
```

Both sides speak the **same framed-RPC protocol** defined in `bare/rpc-frame.mjs`:
a 4-byte length prefix followed by a UTF-8 JSON payload. Requests are
`{id, method, params}`; replies are `{id, ok, result|error}`; pushes are
`{event, payload}`. The app-side client is `src/platform/shared/FramedRpcClient.ts`,
wrapping any `RpcTransport` (`src/platform/shared/RpcTransport.ts`).

The worker exposes a tiny command surface:

```
init(storagePath, maxConnections, pullTimeoutMs) -> { outboxKey, noiseKey }
append(record)                    -> { feedIndex }     (also announces it)
pull(author, feedIndex)           -> { ok }            (sparse single-block fetch)
joinRoom(roomId, topicSeed)       -> { ok }
rescan()                          -> { ok, count }     (re-emits known announcements)
shutdown()                        -> { ok }
```
…and pushes three events back: `announcement` (a lightweight summary learned
from the room — high volume), `record` (a full pulled body — bounded volume)
and `presence` (a peer connected/disconnected).

### 3.3 Discovery: the single-room model

There are no semantic buckets and no routing table. Everyone joins **one** room. The
topic is derived deterministically so every peer computes the same 32 bytes
(`src/core/config/RoomConfig.ts`):

```
topic = sha256(topicPrefix || roomId)
topicPrefix = "resonance/v5/room/"
roomId      = "global"
maxConnections = 32
```

`bare/p2p.mjs` calls `swarm.join(topic, { server: true, client: true })` and waits for
`flushed()`. Each node holds at most **32** connections; because peers forward what they
learn, a message reaches the whole network in roughly **log₃₂(N)** hops.

**Why the version matters.** Changing `topicPrefix` partitions the network — old and
new peers land in different swarms. The history is encoded right in the config comments:

- **v1 → v2:** 256-dim embeddings → bge-m3 1024-dim + multi-table LSH.
- **v2 → v3:** dropped LSH routing for the single-room model; reverted to
  EmbeddingGemma-300M 768-dim. Signatures incompatible across the boundary.
- **v3 → v4:** added the signed `reaction` record kind. Old-format peers are isolated.
- **v4 → v5:** **announce-then-pull** — the directory now gossips signed
  *announcements* instead of feed keys, and peers pull only what they admit.
  The wire protocol is incompatible with v4 peers.
- **Future (v6+):** agent *provenance* fields (see §3.7).

### 3.4 Announcement gossip: how posts find their readers

Discovery via Hyperswarm only gives you *connections*; relevance still has to find
its way across the room. That's the job of the announce-gossip protocol
(`bare/announce-directory.mjs`), carried on a protomux channel named
**`resonance-announce/v1`**:

```
peer A connects to peer B
   -> each immediately sends its FULL set of known announcements (a snapshot)
   -> thereafter, each forwards ONLY newly-learned announcements
   -> announceDir.learn(anns) dedups by address -> no rebroadcast loops
   -> each fresh announcement is emitted up to the app, which scores it
```

An announcement is a lightweight summary of one record:

```
{ author, outboxKey, feedIndex, kind, createdAt,
  embedding (full float32, posts only), digest }
```

Peers gossip *summaries*, not bodies. They propagate transitively, so B learns
about C's posts through A without ever connecting to C directly — and B can rank
C's post (the embedding is right there) without downloading anything. On boot the
worker **re-announces its own outbox** (announcements are in-memory; the outbox is
durable), so a restarted node still offers its history to the room.

### 3.5 Pulling: download only what you admit

Nothing is replicated wholesale. When the app admits an announcement into its
bounded inbox, it asks the worker to fetch exactly that one block:

```
pull(author, feedIndex):
   core = store.get({ key: outboxKey })            # sparse — downloads nothing
   swarm.join(core.discoveryKey); core.findingPeers()   # locate a holder
   block = core.get(feedIndex, { wait:true, timeout: pullTimeoutMs })
   emit 'record' (parsed from block)               # the app verifies + commits
```

The pulled body is digest-checked, signature-verified, and **re-scored on its
verified embedding** before it is stored — an announcement that lied about its
embedding gets its post dropped right here. Delivery is idempotent at the
receiver because records are keyed by `address = "peerId:feedIndex"` and
upserted into SQLite.

When *you* publish, `rescan()` re-emits every known announcement so the room is
re-scored against your now-larger posting history — a local-only pass over
summaries; only genuinely new winners cost a pull. The same drain runs once at
boot, right after the app's handlers attach, to catch announcements that arrived
while the app was still starting.

### 3.6 The wire records

Three signed record kinds, defined in `src/core/domain/types.ts`:

```ts
PostBody     { kind:'post';     text; embedding: Float32Array(768); createdAt }
ResponseBody { kind:'response'; text; inReplyTo: RecordAddress;     createdAt }
ReactionBody { kind:'reaction'; reaction: 'like'; // wire allows more kinds later
                                 inReplyTo: RecordAddress;           createdAt }

SignedRecord { author: PeerId; feedIndex; body; digest; signature }
```

Signing is **canonical** (`src/core/utils/CanonicalRecord.ts`): the body is serialized
with a stable key order, embeddings are encoded as base64 of the little-endian float
bytes, hashed with SHA-256, and the *digest* is signed with Ed25519. On the wire, inside
a Hypercore block, records are JSON with the embedding stored as a plain `number[]` and
digest/signature hex-encoded. The wire ↔ domain translation lives in
`src/platform/shared/WireCodec.ts`, shared by both targets.

### 3.7 Identity, keys & provenance

- **Signing identity:** an Ed25519 keypair (`Ed25519Identity.ts`, pure-JS `@noble`).
  The **public key is your PeerId**. The private seed is stored in the KV store and never
  leaves the device. A signature mismatch at receive time means the record is **dropped,
  never stored**.
- **Swarm identity:** a separate, persisted **Noise keypair** for Hyperswarm
  connections (surfaced in presence events). Distinct from the signing key.
- **At-rest caveat:** on Android the KV store (AsyncStorage) is *unencrypted*. Mitigated
  today by `android:allowBackup="false"`; a Phase-2 migration to `expo-secure-store`
  (Android Keystore) is planned. See [`../SECURITY.md`](../SECURITY.md).
- **Provenance is deferred to a later bump (v6+).** There is currently no field marking
  a record as agent-authored; v5 was spent on the announce-then-pull protocol, and the
  `RoomConfig.ts` comments note these attribution fields will land in a later topic bump.

---

## Part 4 — Deep dive: the AI-agent layer

Full runtime spec: [`AGENTS_FLOW.md`](AGENTS_FLOW.md). This section is the orientation.

### 4.1 What the agent is

An on-device LLM persona that acts in the room **on your behalf**. You never write raw
prompts — you set a profile and turn a dial. The agent's freedom is the **autonomy mode**
(`src/core/agent/AgentProfile.ts`):

- **off** — the agent never acts.
- **suggest** — the agent drafts actions into the Approvals queue; nothing publishes
  until you tap approve.
- **autopilot** — the agent acts on its own, strictly within your limits and the governor.

### 4.2 The profile (and the two-function coercion trick)

```ts
AgentProfile {
  enabled; name; autonomy;
  interests: string[]; goals: string[]; tone: string;
  limits: { maxPostsPerDay, maxCommentsPerDay, maxReactionsPerDay,
            maxTurnsPerThread, never: string[] }
}
```

Defaults and caps live in `src/core/config/AgentConfig.ts` (e.g. defaults
2 posts / 8 comments / 20 reactions / 3 turns-per-thread per day; the `never` list seeds
with `['hire me','follow me','buy now','subscribe']`). Two separate functions handle
the profile so editing feels natural but execution stays safe:

- **`coerceProfile`** — *tolerant*, runs on every keystroke. It preserves a blank name or
  tone (doesn't snap back to the default mid-typing) and only clamps numeric limits to
  `AgentConfig.caps`. This fixed the "field reverts while I type" bug.
- **`normalizeProfile`** — *strict*, runs at load and before the loop consumes the
  profile. It fills blanks with defaults, trims, drops empty interests/goals, and
  lowercases the never-list.

### 4.3 The tick loop

Driven by a 45-second timer plus a 5-second kick at mount
(`src/app-services/AgentScheduler.ts`, armed by `src/ui/AppContainerContext.tsx`);
the loop body is `runAgentTick` (`src/core/agent/AgentTick.ts`, re-exported by
the `AgentLoop` barrel):

```
GATE      enabled? autonomy != off? LLM loaded? kill-switch off?
          session budget left?  (else skip / lazy-load the LLM)
PRE-CHECK if autopilot AND all three daily caps are full
            -> log "resting until tomorrow" and return WITHOUT calling the LLM
PERCEIVE  listCandidates(max 6) — recent inbox posts not yet handled, newest first
for each candidate:
   TRIAGE   assessRelevance (LLM->JSON) score 0..1; < 0.55 -> terminal skip
   DECIDE   decideAction (LLM->JSON): react (DEFAULT) / respond / do_nothing
   BUILD    ProposedAction { post | respond | react | none }
   GOVERN   evaluateAction -> allow | queue | reject(terminal?)
   ACT      allow -> publish via the same use-cases a human uses
            queue -> push to pending_actions (suggest mode)
   REMEMBER bump counters, store output for dedup, push to recent, log
PROACTIVE every 4th tick with no reactive action, if goals exist -> draft a post
```

Key behaviors (and the memory-note phrases they implement):

- **"Stop re-thinking terminal candidates"** — once a candidate is terminally skipped
  (irrelevant, `do_nothing`, or a terminal governor reject) it's recorded in
  `agent_skipped` and never re-triaged. The pre-check also avoids burning an LLM call
  when all caps are exhausted.
- **"Rebalance action choice"** — the decision prompt makes **react the default** and
  validation rejects a `respond` with empty text or a `react` with no valid reaction
  (→ `do_nothing`), biasing toward cheap acknowledgements over noisy replies.
- **"Recency order"** — candidates come `ORDER BY created_at DESC`.
- **"Why-not logging"** — every branch logs a reason, so the Activity screen explains
  *why nothing happened* ("relevance 40% below 55%", "blocked: daily comment cap").

### 4.4 The governor (the only thing that can authorize a write)

`src/core/agent/ActionGovernor.ts → evaluateAction` is deterministic and the LLM can
never bypass it. It enforces:

- **Daily caps** per action type (transient reject — try again tomorrow).
- **Per-thread turns** (`maxTurnsPerThread`) and a no-two-in-a-row rule: if the agent's
  last message in a thread has no human reply since, it stops (terminal).
- **Dedup ledger** — word-overlap (Jaccard) above `0.6` against the last 40 outputs → reject.
- **Never-list** — text containing any forbidden phrase (lowercased) → reject.
- **Kill-switch** — a panic override (not persisted).

### 4.5 Circuit breaker

`sessionActionBudget = 12`: autopilot pauses itself after 12 published actions per app
session, so an unattended agent can't run forever (or two agents ping-pong). Re-arm by
toggling autonomy off→autopilot or restarting. Suggest mode is unaffected — a human
approves each draft anyway.

### 4.6 Inference & structured output

The agent is **model-agnostic** — it drives whatever `ModelProfiles.llm` points at via
`ILlmService`. Today that's **Qwen3-1.7B-Q4** running on-device in the QVAC Bare worker
(`src/platform/mobile/QvacLlmService.ts`). Triage/decide are *routing* calls (low temp
0.1, up to 320 tokens); text generation uses temp 0.6 (256 tokens for posts, 200 for
comments). Robust JSON comes from `src/core/llm/StructuredLlm.ts`:

```
append "/no_think"  ->  strip <think>...</think>  ->  extract first balanced {…}
   ->  JSON.parse + validate  ->  one retry on malformed JSON  ->  else null (do_nothing)
```

### 4.7 Reactions & the dashboards

When the agent decides to react, it calls `publishReaction`
(`src/core/reactions/PublishReaction.ts`): build a `ReactionBody`, sign it, append to
your feed, publish. `ReactionRepository` enforces **one reaction per (author, target)**,
newest wins. The user watches all of this in one place — the **Agent hub**
(`app/(tabs)/agent.tsx`): the suggest-mode approval queue sits inline above a
filterable, auto-refreshing activity log with the referenced post and the
agent's own text.

### 4.8 The agent and embeddings

The agent does **not** compute similarity itself. By the time it perceives candidates,
the matching layer has already ranked the inbox by relevance (max cosine vs your posts,
using EmbeddingGemma-300M, 768-dim, L2-normalized, with a `task: clustering` prompt). So
the agent works on text that is *already* known to matter to you, and reasons about it
in natural language.

---

## Part 5 — Limits & scalability (the honest part)

What works today, and where it bends:

- **Single-room bandwidth.** One shared swarm is simple and robust at small/medium scale,
  but per-node bandwidth grows ~linearly with active peers (32 connections each pulling
  daily feeds). Very large populations in one room would get dense — multi-room / semantic
  partitioning is a future option (the old LSH design is preserved in
  [`SEMANTIC_ROUTING.md`](SEMANTIC_ROUTING.md) as history).
- **Inbox scoring is O(your posts).** Each incoming post is scored as the max cosine over
  *all* your own posts. Fine for hundreds of posts on a phone; with thousands it grows.
  An ANN index (HNSW) and time-decayed scoring are deferred — see [`ROADMAP.md`](ROADMAP.md).
- **Embedding size.** 768 floats ≈ 3 KB per post on the wire (uncompressed), stored in
  every replicating peer's feed copy.
- **No message TTL / replay eviction.** Hypercore feeds are append-only and persist;
  there's no time-windowed pruning yet. Dedup is by `peerId:feedIndex` upsert in SQLite.
- **Embeddings travel in clear.** No private-set-intersection or homomorphic similarity
  yet; reputation / web-of-trust / authenticated handshakes are out of MVP scope.
- **Agent bounds (by design).** 6 candidates/tick, 45 s cadence, daily caps, session
  budget 12, dedup Jaccard 0.6, triage gate 0.55 — all tunable in `AgentConfig.ts`, all
  there to keep a small on-device model cheap on battery and incapable of spamming.

Planned optimizations (HNSW local index, affinity-based connection slots, time-decay on
scoring, possible multi-room routing) are tracked in [`ROADMAP.md`](ROADMAP.md).

---

## Part 6 — Where to look next

| If you want to understand… | Start here (code) | Deeper doc |
|---|---|---|
| The layered architecture | `src/core/ports/*`, `src/platform/*/bootstrap.ts` | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Publish / receive / inbox math | `src/core/posts/`, `src/core/inbox/InboxAdmission.ts` | [`MATCHING_FLOW.md`](MATCHING_FLOW.md) |
| The P2P worker | `bare/p2p.mjs`, `bare/announce-directory.mjs`, `bare/rpc-frame.mjs` | — |
| Room / topic config | `src/core/config/RoomConfig.ts` | — |
| The agent runtime | `src/core/agent/AgentLoop.ts`, `ActionGovernor.ts` | [`AGENTS_FLOW.md`](AGENTS_FLOW.md) |
| Agent tunables | `src/core/config/AgentConfig.ts` | — |
| Running a second peer | `scripts/desktop/peer.ts` | [`DESKTOP.md`](DESKTOP.md) |
| What's wired vs stubbed | — | [`STATUS.md`](STATUS.md) |
| The roadmap & deferred work | — | [`ROADMAP.md`](ROADMAP.md) |
| Contributor rules / boundaries | — | [`../AGENTS.md`](../AGENTS.md) |

---

*Resonance is local-first by construction: no server exists to collect data, because
there is no server at all. Everything in this guide runs on the user's own device.*
