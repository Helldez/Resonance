import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PlatformContainer } from '@platform/bootstrap';
import { bootstrapPlatform } from '@platform/bootstrap';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useSettingsStore } from '@domain/SettingsStore';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { RoomConfig } from '@core/config/RoomConfig';
import { decideAdmission } from '@core/inbox/InboxAdmission';
import { addressOf } from '@core/utils/AddressOf';
import { canonicalDigest } from '@core/utils/CanonicalRecord';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import type { RecordAddress, SignedRecord } from '@core/domain/types';
import type { ModelProgressUpdate } from '@qvac/sdk';
import { AgentConfig } from '@core/config/AgentConfig';
import { normalizeProfile, type AgentProfile } from '@core/agent/AgentProfile';
import {
  runAgentTick,
  runAgentPost,
  type AgentCandidate,
  type AgentLoopDeps,
} from '@core/agent/AgentLoop';
import { useAgentProfileStore } from '@domain/AgentProfileStore';

/** An own post embedding tagged with the address of the post it came from. */
interface OwnEmbedding {
  readonly address: RecordAddress;
  readonly embedding: Float32Array;
}

const AppContainerContext = createContext<PlatformContainer | null>(null);

export function AppContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<PlatformContainer | null>(null);
  const setStage = useBootstrapStore((s) => s.setStage);
  const setProgress = useBootstrapStore((s) => s.setProgress);
  const setError = useBootstrapStore((s) => s.setError);
  const setSelf = useBootstrapStore((s) => s.setSelf);
  const aboutYouEmbeddingRef = useRef<Float32Array | null>(null);
  const containerRef = useRef<PlatformContainer | null>(null);
  const receiverContext = useSettingsStore((s) => s.receiverContext);

  useEffect(() => {
    let cancelled = false;
    let disposeRecordHandler: (() => void) | null = null;

    const run = async (): Promise<void> => {
      try {
        setStage('identity');
        const c = await bootstrapPlatform();
        if (cancelled) {
          return;
        }
        setSelf(c.self);
        containerRef.current = c;

        setStage('embedding-model');
        await c.embedderConcrete.load((p: ModelProgressUpdate) => {
          setProgress(p.downloaded ?? 0, p.total ?? 0);
        });
        if (cancelled) {
          return;
        }

        setStage('network');
        const receiverContext = useSettingsStore.getState().receiverContext;
        // Cold start with no profile: leave the interest embedding null rather
        // than scoring against a generic fallback. EmbeddingGemma is anisotropic
        // (unrelated texts still cosine ~0.3-0.5), so a fallback vector would
        // admit nearly every post with a meaningless score. Null makes
        // scoreRemotePost return null → the bounded inbox rejects until the user
        // either writes their first post or sets "About you".
        const aboutYouEmbedding =
          receiverContext.trim().length === 0
            ? null
            : await c.embedder.embed(receiverContext);
        aboutYouEmbeddingRef.current = aboutYouEmbedding;

        // Load own posts' embeddings (with their addresses) so the
        // receiver-side similarity can be computed against the user's actual
        // posting history rather than a static "About you" description, and so
        // each remote post can record which own post it matched.
        const ownFromDb = await c.posts.getOwnEmbeddingsWithAddress(
          c.self,
          MatchingConfig.embeddingDim,
        );
        externalOwnEmbeddings.current = ownFromDb;

        // Single-room model: join the one shared room. There is no per-post
        // routing or bucket churn — Hyperswarm discovery plus directory
        // gossip carry every post to every peer.
        await c.network.joinRoom();
        console.log('[rn] joined single room');

        // Single source of truth for incoming records: verify signature,
        // score against own posts, admit into the bounded inbox, persist
        // into SQLite. The Inbox/Thread screens auto-refresh from SQLite.
        disposeRecordHandler = c.network.onRecord((record) => {
          void persistRecord(
            c,
            record,
            externalOwnEmbeddings.current,
            aboutYouEmbeddingRef.current,
          );
        });

        setStage('ready');
        setContainer(c);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (disposeRecordHandler !== null) {
        disposeRecordHandler();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the cold-start "About you" embedding live. The empty-state card in
  // the feed invites a new user to set their interests in Settings; without
  // this effect that change would not take effect until an app restart,
  // because the embedding was captured once at boot. Re-embed in the
  // background whenever the text changes and the container is ready.
  useEffect(() => {
    const c = containerRef.current;
    if (c === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // Mirror the boot path: an empty "About you" means no interest signal,
        // so the embedding stays null and cold-start posts are not admitted.
        const embedding =
          receiverContext.trim().length === 0
            ? null
            : await c.embedder.embed(receiverContext);
        if (!cancelled) {
          aboutYouEmbeddingRef.current = embedding;
          console.log(
            `[rn] about-you embedding ${embedding === null ? 'cleared (no profile)' : 'refreshed'}`,
          );
        }
      } catch (e) {
        console.warn(
          `[rn] about-you re-embed failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [container, receiverContext]);

  // The autonomous agent loop. Once the container is ready and the LLM is
  // loaded, the agent wakes on a slow timer: perceive the inbox, triage, let
  // the LLM propose, and run every proposal through the deterministic
  // ActionGovernor before anything is published. Disabled when the profile is
  // off — the getState() read keeps the latest profile without re-subscribing.
  useEffect(() => {
    const c = containerRef.current;
    if (c === null || container === null) {
      return;
    }
    let cancelled = false;
    let running = false;
    let tick = 0;
    // Autopilot circuit breaker: actions published this session, and whether we
    // already announced the pause (so we log it once, not every tick).
    let sessionActions = 0;
    let pauseAnnounced = false;
    let lastAutonomy = '';

    const runOnce = async (): Promise<void> => {
      if (cancelled || running) {
        return;
      }
      const { profile, killSwitch } = useAgentProfileStore.getState();
      const norm = normalizeProfile(profile);
      // Toggling autonomy (e.g. off→autopilot) re-arms the session budget.
      if (norm.autonomy !== lastAutonomy) {
        lastAutonomy = norm.autonomy;
        sessionActions = 0;
        pauseAnnounced = false;
      }
      // Log the gate so logcat shows exactly why a tick is or isn't running.
      console.log(
        `[agent] gate llmLoaded=${c.llmConcrete.isLoaded} enabled=${norm.enabled} autonomy=${norm.autonomy} kill=${killSwitch} goals=${norm.goals.length} interests=${norm.interests.length}`,
      );
      if (!norm.enabled || norm.autonomy === 'off') {
        return;
      }
      if (!c.llmConcrete.isLoaded) {
        // The agent needs the LLM. Trigger a background load once so an enabled
        // agent becomes functional without the user having to visit Settings;
        // skip this tick and act on the next one after the model is ready.
        console.log('[agent] LLM not loaded yet — kicking off background load');
        void c.llmConcrete.load().catch((e) => {
          console.warn(`[agent] LLM load failed: ${e instanceof Error ? e.message : String(e)}`);
        });
        return;
      }
      // Autopilot circuit breaker: once the session budget is spent, stop
      // publishing on autopilot (Suggest still queues — a human gates those).
      if (norm.autonomy === 'autopilot' && sessionActions >= AgentConfig.sessionActionBudget) {
        if (!pauseAnnounced) {
          pauseAnnounced = true;
          await c.agentLog.append(
            c.clock.now(),
            'tick',
            `Autopilot paused — reached ${AgentConfig.sessionActionBudget} actions this session. Toggle autonomy off→autopilot in My agent to resume.`,
          );
        }
        return;
      }
      running = true;
      try {
        const deps = buildAgentDeps(c, norm, killSwitch);
        const report = await runAgentTick(deps);
        tick++;
        sessionActions += report.published;
        console.log(
          `[rn] agent tick considered=${report.considered} published=${report.published} queued=${report.queued} rejected=${report.rejected} sessionActions=${sessionActions}`,
        );
        if (report.considered === 0) {
          await c.agentLog.append(
            c.clock.now(),
            'tick',
            'Woke up — nothing new in the inbox to consider',
          );
        }
        // Seed a post toward a goal on a steady cadence — decoupled from the
        // reactive output. Previously this only fired when the tick neither
        // published nor queued anything, so reactions/replies pre-empted it and
        // the agent almost never posted. Now it runs every 4th tick regardless;
        // the daily cap (maxPostsPerDay) and the session budget bound it, and
        // runAgentPost no-ops without a goal or once the cap is hit.
        if (tick % 4 === 1) {
          const posted = await runAgentPost(deps);
          if (posted) {
            sessionActions += 1;
          }
          console.log(`[agent] proactive post attempted=${posted}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[rn] agent tick failed: ${msg}`);
        try {
          await c.agentLog.append(c.clock.now(), 'error', `Tick failed: ${msg}`);
        } catch {
          // logging must never crash the loop
        }
      } finally {
        running = false;
      }
    };

    const interval = setInterval(() => {
      void runOnce();
    }, AgentConfig.tickIntervalMs);
    const kick = setTimeout(() => {
      void runOnce();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(kick);
    };
  }, [container]);

  return (
    <AppContainerContext.Provider value={container}>{children}</AppContainerContext.Provider>
  );
}

export function useAppContainer(): PlatformContainer | null {
  return useContext(AppContainerContext);
}

export function useRequireContainer(): PlatformContainer {
  const c = useContext(AppContainerContext);
  if (c === null) {
    throw new Error('App container not ready');
  }
  return c;
}

/**
 * The list of the local user's post embeddings, used by the receiver-side
 * similarity scorer. Mutated in place when the user composes a new post.
 *
 * Exposed via a module-level ref because the Compose screen needs to push
 * into it without going through the React tree.
 */
const externalOwnEmbeddings: { current: OwnEmbedding[] } = { current: [] };

export function appendOwnEmbedding(address: RecordAddress, v: Float32Array): void {
  externalOwnEmbeddings.current.push({ address, embedding: v });
}

export function getOwnEmbeddingsSnapshot(): ReadonlyArray<OwnEmbedding> {
  return externalOwnEmbeddings.current;
}

/**
 * Re-score every remote post in the inbox against the user's current own
 * posts. Called after publishing a post: the set of own posts just grew, so
 * each remote post's MAX-cosine similarity (and the own post it matched) may
 * have changed. This keeps the grouped inbox correct — a remote post received
 * before post #k can now be grouped under post #k — and resolves the cold→warm
 * transition (old About-you-based scores are overwritten with own-post scores,
 * restoring a single comparable metric for inbox eviction).
 */
export async function rescoreInboxAgainstOwnPosts(
  c: PlatformContainer,
): Promise<void> {
  const own = getOwnEmbeddingsSnapshot();
  if (own.length === 0) {
    return;
  }
  const remote = await c.posts.getRemoteEmbeddings(c.self, MatchingConfig.embeddingDim);
  for (const post of remote) {
    const { similarity, matchedOwnAddress } = scoreRemotePost(post.embedding, own, null);
    await c.posts.updateScore(post.address, similarity, matchedOwnAddress);
  }
  console.log(`[rn] rescored inbox count=${remote.length} ownPosts=${own.length}`);
}

/**
 * Assemble the agent loop's dependencies from the platform container. The data
 * callbacks below are the only place the loop touches SQLite; the loop itself
 * stays pure and testable. `persistOwn` mirrors `persistRecord`'s own-record
 * handling, because the worker does not echo our own appends back to us.
 */
function buildAgentDeps(
  c: PlatformContainer,
  profile: AgentProfile,
  killSwitch: boolean,
): AgentLoopDeps {
  return {
    llm: c.llm,
    embedder: c.embedder,
    mailbox: c.mailbox,
    network: c.network,
    identity: c.identity,
    clock: c.clock,
    self: c.self,
    profile,
    killSwitch,
    activity: c.agentActivity,
    pending: c.pending,
    logSink: {
      log: (phase, summary, target, text, refText) =>
        c.agentLog.append(
          c.clock.now(),
          phase,
          summary,
          target ?? null,
          text ?? null,
          refText ?? null,
        ),
    },
    listCandidates: async (limit: number): Promise<AgentCandidate[]> => {
      const rows = await c.database.query<{
        address: string;
        text: string;
        similarity: number | null;
      }>(
        `SELECT address, text, similarity FROM posts
         WHERE author != ?
           AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.in_reply_to = posts.address AND r.author = ?)
           AND NOT EXISTS (SELECT 1 FROM reactions x WHERE x.in_reply_to = posts.address AND x.author = ?)
           AND NOT EXISTS (SELECT 1 FROM agent_pending p WHERE p.target = posts.address)
           AND NOT EXISTS (SELECT 1 FROM agent_skipped s WHERE s.target = posts.address)
         ORDER BY created_at DESC
         LIMIT ?`,
        [c.self, c.self, c.self, limit],
      );
      return rows.map((r) => ({
        address: r.address as RecordAddress,
        text: r.text,
        similarity: r.similarity,
      }));
    },
    listReplyCandidates: async (limit: number): Promise<AgentCandidate[]> => {
      // Posts the user is part of (their own, or ones the agent replied to)
      // that carry an unanswered peer comment — the latest response is not the
      // agent's — and where the agent is still under the per-thread turn cap.
      const rows = await c.database.query<{ address: string; text: string }>(
        `SELECT p.address AS address, p.text AS text
         FROM posts p
         WHERE (
                 p.author = ?
                 OR EXISTS (SELECT 1 FROM responses rs WHERE rs.in_reply_to = p.address AND rs.author = ?)
               )
           AND EXISTS (SELECT 1 FROM responses rp WHERE rp.in_reply_to = p.address AND rp.author != ?)
           AND (
                 SELECT r3.author FROM responses r3
                 WHERE r3.in_reply_to = p.address
                 ORDER BY r3.created_at DESC LIMIT 1
               ) != ?
           AND (
                 SELECT COUNT(*) FROM responses rt WHERE rt.in_reply_to = p.address AND rt.author = ?
               ) < ?
         ORDER BY (
           SELECT MAX(rm.created_at) FROM responses rm WHERE rm.in_reply_to = p.address
         ) DESC
         LIMIT ?`,
        [c.self, c.self, c.self, c.self, c.self, profile.limits.maxTurnsPerThread, limit],
      );
      // similarity is irrelevant for replies — these run in the respond band.
      return rows.map((r) => ({
        address: r.address as RecordAddress,
        text: r.text,
        similarity: null,
      }));
    },
    getThreadContext: async (target: RecordAddress): Promise<string | null> => {
      const resp = await c.database.query<{ author: string; text: string }>(
        'SELECT author, text FROM responses WHERE in_reply_to = ? ORDER BY created_at ASC LIMIT 8',
        [target],
      );
      if (resp.length === 0) {
        return null;
      }
      return resp.map((r) => `${r.author === c.self ? 'you' : 'peer'}: ${r.text}`).join('\n');
    },
    getRecentThreadTexts: async (target: RecordAddress, limit: number): Promise<string[]> => {
      const rows = await c.database.query<{ text: string }>(
        'SELECT text FROM responses WHERE in_reply_to = ? ORDER BY created_at DESC LIMIT ?',
        [target, limit],
      );
      return rows.map((r) => r.text);
    },
    countAgentTurnsInThread: async (target: RecordAddress): Promise<number> => {
      const rows = await c.database.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM responses WHERE in_reply_to = ? AND author = ?',
        [target, c.self],
      );
      return rows[0]?.n ?? 0;
    },
    lastInThreadIsSelfNoHuman: async (target: RecordAddress): Promise<boolean> => {
      const rows = await c.database.query<{ author: string }>(
        'SELECT author FROM responses WHERE in_reply_to = ? ORDER BY created_at DESC LIMIT 1',
        [target],
      );
      return rows.length > 0 && rows[0].author === c.self;
    },
    persistOwn: async (record: SignedRecord): Promise<void> => {
      const address = addressOf(record.author, record.feedIndex);
      if (record.body.kind === 'post') {
        await c.posts.upsert(address, record.author, record.feedIndex, record.body, null);
        // Mirror the manual-publish path (compose.tsx): add the agent's own post
        // to the live matching basis so incoming peers group under it instead of
        // landing in "Based on your interests", and re-group already-received
        // posts — without waiting for an app restart to reload from the DB.
        appendOwnEmbedding(address, record.body.embedding);
        void rescoreInboxAgainstOwnPosts(c).catch(() => {
          /* best-effort: never crash the agent loop on a rescore failure */
        });
      } else if (record.body.kind === 'reaction') {
        await c.reactions.applyFromRecord(address, record.author, record.feedIndex, record.body);
      } else {
        await c.responses.upsert(address, record.author, record.feedIndex, record.body);
      }
    },
  };
}

async function persistRecord(
  c: PlatformContainer,
  record: import('@core/domain/types').SignedRecord,
  ownEmbeddings: ReadonlyArray<OwnEmbedding>,
  interestProfile: Float32Array | null,
): Promise<void> {
  const shortAuthor = String(record.author).slice(0, 12);
  const expectedDigest = await canonicalDigest(record.body);
  if (!bytesEqual(expectedDigest, record.digest)) {
    console.warn(
      `[rn] persistRecord DIGEST MISMATCH author=${shortAuthor} expected=${bytesToHexShort(expectedDigest)} got=${bytesToHexShort(record.digest)}`,
    );
    return;
  }
  const sigOk = await c.identity.verify(record.digest, record.signature, record.author);
  if (!sigOk) {
    console.warn(`[rn] persistRecord SIGNATURE INVALID author=${shortAuthor}`);
    return;
  }
  const address = addressOf(record.author, record.feedIndex);

  if (record.body.kind === 'post') {
    const isOwn = record.author === c.self;
    if (isOwn) {
      await c.posts.upsert(address, record.author, record.feedIndex, record.body, null);
      await c.peers.touch(record.author, c.clock.now());
      return;
    }

    // Bounded top-K inbox admission (conf 9). Score the post, then decide
    // whether it earns a slot — drop below threshold, admit while under
    // capacity, or evict the weakest occupant when the newcomer beats it.
    const { similarity, matchedOwnAddress } = scoreRemotePost(
      record.body.embedding,
      ownEmbeddings,
      interestProfile,
    );
    const currentCount = await c.posts.countRemotePosts(c.self);
    const min = await c.posts.minSimilarityRemotePost(c.self);
    const decision = decideAdmission({
      similarity,
      currentCount,
      min,
      config: {
        capacity: RoomConfig.inboxCapacity,
        minSimilarity: RoomConfig.inboxMinSimilarity,
      },
    });
    if (decision.kind === 'reject-threshold' || decision.kind === 'reject-full') {
      console.log(
        `[rn] inbox drop author=${shortAuthor} similarity=${similarity === null ? 'null' : similarity.toFixed(3)} reason=${decision.kind}`,
      );
      return;
    }
    if (decision.kind === 'replace') {
      await c.posts.delete(decision.evict);
    }
    await c.posts.upsert(
      address,
      record.author,
      record.feedIndex,
      record.body,
      similarity,
      matchedOwnAddress,
    );
    console.log(
      `[rn] inbox ${decision.kind} author=${shortAuthor} similarity=${similarity === null ? 'null' : similarity.toFixed(3)} count=${currentCount}`,
    );
    await c.peers.touch(record.author, c.clock.now());
    return;
  }

  if (record.body.kind === 'reaction') {
    await c.reactions.applyFromRecord(
      address,
      record.author,
      record.feedIndex,
      record.body,
    );
    await c.peers.touch(record.author, c.clock.now());
    return;
  }

  await c.responses.upsert(address, record.author, record.feedIndex, record.body);
  await c.peers.touch(record.author, c.clock.now());
}

/** Result of scoring an incoming post against the local context. */
interface RemoteScore {
  /** MAX cosine vs own posts, or the About-you fallback; null if unscorable. */
  readonly similarity: number | null;
  /**
   * Address of the own post that produced the MAX cosine, so the inbox can
   * group this remote post beneath it. Null on the cold-start (About-you)
   * path, where there is no own post to attribute the match to.
   */
  readonly matchedOwnAddress: RecordAddress | null;
}

/**
 * Receiver-side scoring for an incoming post.
 *
 * Primary signal: max cosine against the user's own post embeddings — what
 * the user has actually written about is a stronger signal than what they
 * declared in "About you". Also reports which own post won the max, so the
 * inbox can group the remote post under it.
 *
 * Cold-start fallback: cosine against the interest profile (embedding of
 * the "About you" text). Used until the user has at least one post; the
 * matched address is null because there is no own post to attribute it to.
 *
 * `similarity` is null only if neither signal is available.
 */
function scoreRemotePost(
  postEmbedding: Float32Array,
  ownEmbeddings: ReadonlyArray<OwnEmbedding>,
  interestProfile: Float32Array | null,
): RemoteScore {
  if (ownEmbeddings.length > 0) {
    let best = -Infinity;
    let bestIndex = -1;
    for (let i = 0; i < ownEmbeddings.length; i++) {
      try {
        const s = cosineOnUnit(postEmbedding, ownEmbeddings[i].embedding);
        if (s > best) {
          best = s;
          bestIndex = i;
        }
      } catch {
        // dimension mismatch on a stale embedding — skip it
      }
    }
    if (bestIndex >= 0) {
      return {
        similarity: best,
        matchedOwnAddress: ownEmbeddings[bestIndex].address,
      };
    }
  }
  if (interestProfile !== null) {
    try {
      return {
        similarity: cosineOnUnit(postEmbedding, interestProfile),
        matchedOwnAddress: null,
      };
    } catch {
      return { similarity: null, matchedOwnAddress: null };
    }
  }
  return { similarity: null, matchedOwnAddress: null };
}

function bytesToHexShort(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < Math.min(bytes.length, 6); i++) {
    const b = bytes[i];
    hex += (b >>> 4).toString(16);
    hex += (b & 0xf).toString(16);
  }
  return hex;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
