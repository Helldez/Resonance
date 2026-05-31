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
import type { RecordAddress } from '@core/domain/types';
import type { ModelProgressUpdate } from '@qvac/sdk';

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
        const interestText = receiverContext.trim().length === 0
          ? MatchingConfig.fallbackInterestText
          : receiverContext;
        const aboutYouEmbedding = await c.embedder.embed(interestText);
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
        const interestText = receiverContext.trim().length === 0
          ? MatchingConfig.fallbackInterestText
          : receiverContext;
        const embedding = await c.embedder.embed(interestText);
        if (!cancelled) {
          aboutYouEmbeddingRef.current = embedding;
          console.log('[rn] about-you embedding refreshed');
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
