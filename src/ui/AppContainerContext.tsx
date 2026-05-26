import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MobileContainer } from '@platform/mobile/bootstrap';
import { bootstrapMobile } from '@platform/mobile/bootstrap';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useSettingsStore } from '@domain/SettingsStore';
import { useInboxStore } from '@domain/InboxStore';
import { startSyncEngine } from '@core/net/SyncEngine';
import { lshBucketOf } from '@core/matching/LshBucket';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { addressOf } from '@core/utils/AddressOf';
import { canonicalDigest } from '@core/utils/CanonicalRecord';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import type { BucketId } from '@core/domain/types';
import type { ModelProgressUpdate } from '@qvac/sdk';

const AppContainerContext = createContext<MobileContainer | null>(null);

export function AppContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<MobileContainer | null>(null);
  const setStage = useBootstrapStore((s) => s.setStage);
  const setProgress = useBootstrapStore((s) => s.setProgress);
  const setError = useBootstrapStore((s) => s.setError);
  const setSelf = useBootstrapStore((s) => s.setSelf);
  const inboxAdd = useInboxStore((s) => s.add);
  const interestProfileRef = useRef<Float32Array | null>(null);
  const ownEmbeddingsRef = useRef<Float32Array[]>([]);
  const currentBucketRef = useRef<BucketId | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | null = null;

    const run = async (): Promise<void> => {
      try {
        setStage('identity');
        const c = await bootstrapMobile();
        if (cancelled) {
          return;
        }
        setSelf(c.self);

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
        const interestProfile = await c.embedder.embed(interestText);
        interestProfileRef.current = interestProfile;

        // Load own posts' embeddings so the receiver-side similarity can
        // be computed against the user's actual posting history rather
        // than a static "About you" description. Mirror to the
        // module-level ref so Compose can append new embeddings as the
        // user posts.
        const ownFromDb = await c.posts.getOwnEmbeddings(
          c.self,
          MatchingConfig.embeddingDim,
        );
        ownEmbeddingsRef.current = ownFromDb;
        externalOwnEmbeddings.current = ownFromDb;

        const bucket = lshBucketOf(
          interestProfile,
          MatchingConfig.embeddingDim,
          MatchingConfig.lshBits,
          MatchingConfig.lshSeed,
        );
        await c.network.joinBucket(bucket);
        currentBucketRef.current = bucket;

        stopSync = startSyncEngine({
          network: c.network,
          mailbox: c.mailbox,
          getInterestProfile: () => interestProfileRef.current ?? interestProfile,
          onInboxItem: (scored) => {
            void persistAndAnnounce(c, scored, inboxAdd);
          },
        }).stop;

        // Persist incoming records (including own re-receives) to SQLite for
        // the Thread view. persistRecord uses the latest own-posts cache to
        // compute similarity as max(cosine vs each own post); when the user
        // has no posts yet (cold start) we fall back to the interest profile.
        c.network.onRecord((record) => {
          void persistRecord(
            c,
            record,
            externalOwnEmbeddings.current,
            interestProfileRef.current,
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
      if (stopSync !== null) {
        stopSync();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppContainerContext.Provider value={container}>{children}</AppContainerContext.Provider>
  );
}

export function useAppContainer(): MobileContainer | null {
  return useContext(AppContainerContext);
}

export function useRequireContainer(): MobileContainer {
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
const externalOwnEmbeddings: { current: Float32Array[] } = { current: [] };

export function appendOwnEmbedding(v: Float32Array): void {
  externalOwnEmbeddings.current.push(v);
}

export function getOwnEmbeddingsSnapshot(): Float32Array[] {
  return externalOwnEmbeddings.current;
}

async function persistRecord(
  c: MobileContainer,
  record: import('@core/domain/types').SignedRecord,
  ownEmbeddings: ReadonlyArray<Float32Array>,
  interestProfile: Float32Array | null,
): Promise<void> {
  const shortAuthor = String(record.author).slice(0, 12);
  console.log(
    `[rn] persistRecord enter author=${shortAuthor} feedIndex=${record.feedIndex} kind=${record.body.kind}`,
  );
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
    let similarity: number | null = null;
    if (!isOwn) {
      similarity = scoreRemotePost(record.body.embedding, ownEmbeddings, interestProfile);
    }
    await c.posts.upsert(address, record.author, record.feedIndex, record.body, similarity);
    console.log(
      `[rn] persisted post address=${address} author=${shortAuthor} similarity=${similarity === null ? 'null' : similarity.toFixed(3)}`,
    );
  } else {
    await c.responses.upsert(address, record.author, record.feedIndex, record.body);
    console.log(`[rn] persisted response address=${address} author=${shortAuthor}`);
  }
  await c.peers.touch(record.author, c.clock.now());
}

/**
 * Receiver-side scoring for an incoming post.
 *
 * Primary signal: max cosine against the user's own post embeddings — what
 * the user has actually written about is a stronger signal than what they
 * declared in "About you".
 *
 * Cold-start fallback: cosine against the interest profile (embedding of
 * the "About you" text). Used until the user has at least one post.
 *
 * Returns null only if neither signal is available.
 */
function scoreRemotePost(
  postEmbedding: Float32Array,
  ownEmbeddings: ReadonlyArray<Float32Array>,
  interestProfile: Float32Array | null,
): number | null {
  if (ownEmbeddings.length > 0) {
    let best = -Infinity;
    for (let i = 0; i < ownEmbeddings.length; i++) {
      try {
        const s = cosineOnUnit(postEmbedding, ownEmbeddings[i]);
        if (s > best) {
          best = s;
        }
      } catch (e) {
        // Skip embeddings that don't match the expected dimension.
      }
    }
    if (best > -Infinity) {
      return best;
    }
  }
  if (interestProfile !== null) {
    try {
      return cosineOnUnit(postEmbedding, interestProfile);
    } catch (e) {
      return null;
    }
  }
  return null;
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

async function persistAndAnnounce(
  c: MobileContainer,
  scored: import('@core/domain/types').ScoredPost,
  inboxAdd: (item: import('@core/domain/types').ScoredPost) => void,
): Promise<void> {
  await c.posts.upsert(
    scored.address,
    scored.author,
    -1,
    scored.post,
    scored.similarity,
  );
  inboxAdd(scored);
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
