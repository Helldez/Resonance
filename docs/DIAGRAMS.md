# Resonance — Architecture Diagrams

> Generated from a direct reading of the source tree (not from prose docs).
> Every box maps to a real file or symbol; paths are given so each diagram is
> auditable. Render with any Mermaid-aware viewer (GitHub renders these inline).
>
> Source-of-truth note: `RoomConfig.topicPrefix` is `resonance/v4/room/`
> (v4 added the signed `reaction` record). Inbox capacity is `200`
> (`RoomConfig.inboxCapacity`).

---

## 1. Hexagonal layering (dependency direction)

The core depends only on `@core/ports/*`. Concrete adapters are injected at the
edges. Arrows point in the direction of the compile-time dependency.

```mermaid
flowchart TB
    subgraph UI["src/app + src/ui + src/domain — presentation"]
        A1["Expo Router screens<br/>index · compose · thread · map<br/>agent · approvals · activity · settings"]
        A2["AppContainerContext.tsx<br/>record handler · agent loop driver"]
        A3["Zustand stores<br/>Bootstrap · Settings · AgentProfile"]
    end

    subgraph CORE["src/core — pure TypeScript (no platform imports)"]
        direction TB
        C1["use cases<br/>posts · responses · reactions · identity"]
        C2["agent/<br/>loop · governor · decide · profile · memory · prompts"]
        C3["matching/ + inbox/ + topics/<br/>cosine · L2 · PCA/UMAP · admission · k-means"]
        C4["llm/ StructuredLlm · config/ tunables · domain/types"]
        P["ports/<br/>ILlmService · IEmbeddingService · IMailbox<br/>IPeerNetwork · IIdentity · IDatabase · IKeyValueStore<br/>IFileSystem · IClock · ILogger"]
    end

    subgraph DATA["src/data — SQLite projections"]
        D1["PostRepository · ResponseRepository · ReactionRepository<br/>PeerRepository · AgentActivity · PendingAction · AgentLog"]
    end

    subgraph PLAT["src/platform — adapters"]
        M["mobile/ (Expo + react-native-bare-kit)"]
        K["desktop/ (Node + Electron + bare subprocess)"]
        R["remote/ (Electron renderer IPC bridge)"]
    end

    subgraph EDGE["runtime edges"]
        W["qvac/worker.entry.mjs<br/>QVAC llama.cpp embed + completion"]
        B["bare/p2p.mjs<br/>Hyperswarm + Hypercore + directory gossip"]
    end

    UI --> CORE
    UI --> DATA
    CORE --> P
    DATA --> P
    M -.implements.-> P
    K -.implements.-> P
    R -.implements.-> P
    M --> W
    M --> B
    K --> W
    K --> B
    D1 --> P
```

---

## 2. Ports & adapters matrix (who implements each port)

```mermaid
flowchart LR
    subgraph Ports
        IL["ILlmService"]
        IE["IEmbeddingService"]
        IM["IMailbox"]
        IN["IPeerNetwork"]
        II["IIdentity"]
        IDB["IDatabase"]
        IKV["IKeyValueStore"]
        IFS["IFileSystem"]
    end

    subgraph Mobile["platform/mobile"]
        QvacLlm["QvacLlmService"]
        QvacEmb["QvacEmbeddingService"]
        BMail["BareWorkletMailbox"]
        BNet["BareWorkletNetwork"]
        Ed["Ed25519Identity"]
        ExpoDb["ExpoSqliteDatabase"]
        AsKv["AsyncStorageKv"]
        ExpoFs["ExpoFileSystem"]
    end

    subgraph Desktop["platform/desktop"]
        DMail["DesktopMailbox"]
        DNet["DesktopNetwork"]
        NodeDb["NodeSqliteDatabase (node:sqlite)"]
        NodeKv["NodeKvStore (JSON-on-disk)"]
        NodeFs["NodeFileSystem"]
    end

    IL --- QvacLlm
    IE --- QvacEmb
    IM --- BMail
    IM --- DMail
    IN --- BNet
    IN --- DNet
    II --- Ed
    IDB --- ExpoDb
    IDB --- NodeDb
    IKV --- AsKv
    IKV --- NodeKv
    IFS --- ExpoFs
    IFS --- NodeFs
```

`QvacLlmService` / `QvacEmbeddingService` / `Ed25519Identity` are re-exported by
the desktop bootstrap — identical implementation on both targets.

---

## 3. Publish path — compose a post

`src/core/posts/CreatePost.ts` → mailbox → Bare worker → swarm.

```mermaid
sequenceDiagram
    autonumber
    participant U as ComposeScreen
    participant CP as createPost()
    participant E as IEmbeddingService (QVAC)
    participant ID as IIdentity (Ed25519)
    participant MB as IMailbox
    participant W as Bare p2p.mjs
    participant SW as Hyperswarm room

    U->>CP: createPost({ text })
    CP->>E: embed(text)  // 768-dim, L2-normalised
    E-->>CP: Float32Array
    CP->>CP: build PostBody, canonicalBytes → SHA-256 digest
    CP->>ID: sign(digest)
    ID-->>CP: signature (Ed25519)
    CP->>MB: append(SignedRecord)
    MB->>W: RPC append(record)
    W->>W: write block to own outbox Hypercore
    W-->>MB: { feedIndex }
    CP->>W: publish() (best-effort, already in outbox)
    W->>SW: replicate block to connected peers
    CP-->>U: { record }
    U->>U: appendOwnEmbedding() + rescoreInboxAgainstOwnPosts()
```

---

## 4. Receive path — inbox admission (bounded top-K)

Handler: `persistRecord()` in `src/ui/AppContainerContext.tsx`,
scoring `src/core/posts/ScoreIncomingPost.ts`, admission
`src/core/inbox/InboxAdmission.ts`.

```mermaid
flowchart TD
    R["onRecord(SignedRecord)<br/>from Bare worker 'record' event"] --> V{verify Ed25519<br/>+ digest match?}
    V -- no --> X1["drop · never stored"]
    V -- yes --> K{body.kind?}

    K -- response --> RR["ResponseRepository.upsert"]
    K -- reaction --> RX["ReactionRepository.applyFromRecord<br/>(1 per author+target)"]
    K -- post --> S["scoreRemotePost:<br/>MAX cosine vs own posts<br/>(cold start: 'About you' embedding)"]

    S --> A{decideAdmission}
    A -- "sim &lt; inboxMinSimilarity (0.3)" --> X2["reject-threshold"]
    A -- "count &lt; inboxCapacity (200)" --> ADM["admit → PostRepository.upsert"]
    A -- "full & sim &gt; weakest" --> REP["replace: evict weakest, upsert"]
    A -- "full & sim ≤ weakest" --> X3["reject-full"]

    ADM --> PEER["PeerRepository.touch"]
    REP --> PEER
    RR --> PEER
    RX --> PEER
```

---

## 5. Local-AI agent loop

`src/core/agent/AgentLoop.ts` driven every `AgentConfig.tickIntervalMs` (45 s)
from `AppContainerContext`. Triage is deterministic (similarity bands); the LLM
only drafts text; `ActionGovernor` is the gate.

```mermaid
flowchart TD
    T["runAgentTick (every 45s)"] --> G0{"enabled & autonomy not off,<br/>LLM loaded, no kill switch,<br/>session budget left?"}
    G0 -- no --> ENDN["idle"]
    G0 -- yes --> CAND["list inbox candidates<br/>(max 6/tick)"]

    CAND --> BAND{"engagementBand(similarity)"}
    BAND -- "at or above respondMin 0.87" --> DR["draftReply() via completeJson<br/>to CommentPayload"]
    BAND -- "at or above reactMin 0.8" --> RX["propose reaction 'like'"]
    BAND -- "below" --> SK["skip then markSkipped"]

    DR --> ECHO{"AgentMemory:<br/>lexical dup or thread echo?"}
    ECHO -- yes --> SK
    ECHO -- no --> GOV
    RX --> GOV["ActionGovernor.evaluateAction"]

    GOV --> DEC{"decision"}
    DEC -- allow --> PUB["publish: createPost /<br/>publishResponse / publishReaction"]
    DEC -- queue --> Q["PendingActionRepository.add<br/>(suggest mode, to /approvals)"]
    DEC -- reject --> RJ["log reason"]

    PUB --> LOG["AgentLog plus counters++"]
    Q --> LOG
    RJ --> LOG

    T2["runAgentPost (every 4th tick)"] -. proactive goal post .-> GOV
```

Governor caps (per `AgentLimits`/`AgentThresholds`): daily posts/comments/
reactions, max turns per thread, no-two-in-a-row, never-list phrases, dedup,
and the autopilot `sessionActionBudget` (12) circuit breaker.

---

## 6. P2P topology — single shared room + directory gossip

One Hyperswarm topic = `sha256(topicPrefix || roomId)`. Each peer owns one
writable outbox Hypercore; the `resonance-directory/v2` protocol gossips outbox
keys transitively so every feed reaches every peer (~log₃₂(N) hops, fan-out
capped at 32).

```mermaid
flowchart LR
    subgraph PeerA["Peer A"]
        OA["outbox Hypercore A"]
        DA["directory state A"]
    end
    subgraph PeerB["Peer B"]
        OB["outbox Hypercore B"]
        DB["directory state B"]
    end
    subgraph PeerC["Peer C"]
        OC["outbox Hypercore C"]
        DC["directory state C"]
    end

    OA <-->|"corestore replicate (Protomux)"| OB
    OB <-->|"corestore replicate"| OC
    DA <-->|"resonance-directory/v2<br/>gossip outbox keys"| DB
    DB <-->|"gossip + transitive forward"| DC
    DA -. "learns C's key via B" .-> OC
```

Wire frame (`bare/rpc-frame.mjs`): `[4-byte BE length][UTF-8 JSON]`.
RPC methods worklet exposes: `init`, `append`, `joinRoom`, `rescan`,
`shutdown`. Events emitted: `record`, `presence`.

---

## 7. RPC / process boundaries per target

```mermaid
flowchart TB
    subgraph MobileProc["Android process"]
        RNm["RN/Hermes JS<br/>(P2pWorklet, FramedRpcClient)"]
        Bm["Bare worklet p2p.mjs"]
        Qm["QVAC worker (llama.cpp)"]
        RNm -- "framed JSON over Worklet IPC" --> Bm
        RNm -- "@qvac/sdk RPC" --> Qm
    end

    subgraph DesktopProc["Desktop"]
        El["Electron main / Node CLI<br/>(DesktopP2pWorker)"]
        Bd["Bare subprocess p2p.mjs<br/>(p2p.desktop-entry.mjs)"]
        Ren["Electron renderer<br/>(RemoteContainer proxies)"]
        Qd["QVAC worker"]
        Ren -- "Electron ipcRenderer.invoke" --> El
        El -- "framed JSON over loopback TCP<br/>127.0.0.1:&lt;rand&gt; (BARE_IPC_PORT)" --> Bd
        El -- "@qvac/sdk RPC" --> Qd
    end
```

---

## 8. Data model — SQLite tables (src/data)

```mermaid
erDiagram
    posts {
        TEXT address PK "peerId:feedIndex"
        TEXT author
        INT  feed_index
        TEXT text
        BLOB embedding "Float32 LE, 768-dim"
        INT  created_at
        REAL similarity "frozen at receive"
        TEXT matched_own_address
    }
    responses {
        TEXT address PK
        TEXT author
        INT  feed_index
        TEXT in_reply_to FK
        TEXT text
        INT  created_at
    }
    reactions {
        TEXT address PK
        TEXT author
        INT  feed_index
        TEXT in_reply_to FK
        TEXT reaction "like"
        INT  created_at
    }
    peers {
        TEXT peer_id PK
        TEXT local_label
        INT  last_seen_at
        INT  helpful_count
        INT  unhelpful_count
    }
    agent_counters {
        TEXT day
        TEXT kind "post|comment|reaction"
        INT  count
    }
    agent_outputs {
        INT  created_at PK
        TEXT text
    }
    agent_pending {
        TEXT id PK
        TEXT kind
        TEXT target
        TEXT text
        TEXT reaction
        TEXT rationale
        INT  created_at
    }
    agent_log {
        INT  id PK
        INT  created_at
        TEXT phase
        TEXT target
        TEXT summary
        TEXT text
        TEXT ref_text
    }

    posts ||--o{ responses : "in_reply_to"
    posts ||--o{ reactions : "in_reply_to"
    peers ||--o{ posts : authors
```

`responses.in_reply_to` / `reactions.in_reply_to` reference a record address
(`posts.address` for top-level, or another response address in a thread) — an
application-level link, not an enforced FK.

---

## 9. Boot sequence

```mermaid
sequenceDiagram
    autonumber
    participant App as AppContainerProvider
    participant BS as BootstrapStore
    participant Id as IdentityManager
    participant Emb as QvacEmbeddingService
    participant Net as IPeerNetwork

    App->>BS: stage = 'identity'
    App->>Id: bootstrapIdentity() → PeerId (Ed25519)
    App->>BS: stage = 'embedding-model'
    App->>Emb: load() EmbeddingGemma-300M (download w/ progress)
    App->>App: load own post embeddings into cache
    App->>BS: stage = 'network'
    App->>Net: joinRoom() — sha256(topicPrefix||roomId)
    App->>Net: onRecord(persistRecord) + onPeerPresence
    App->>BS: stage = 'ready'  // Gate reveals screens
    App->>App: start agent loop (tickIntervalMs)
```
