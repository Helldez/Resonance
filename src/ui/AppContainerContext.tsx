import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MobileContainer } from '@platform/mobile/bootstrap';
import { bootstrapMobile } from '@platform/mobile/bootstrap';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useSettingsStore } from '@domain/SettingsStore';
import { lshBucketsOf } from '@core/matching/LshBucket';
import { computeInterestVector } from '@core/matching/InterestVector';
import type { InterestVectorSource } from '@core/matching/InterestVector';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { addressOf } from '@core/utils/AddressOf';
import { canonicalDigest } from '@core/utils/CanonicalRecord';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import type { BucketId, PeerId } from '@core/domain/types';
import type { ModelProgressUpdate } from '@qvac/sdk';

const AppContainerContext = createContext<MobileContainer | null>(null);

export function AppContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<MobileContainer | null>(null);
  const setStage = useBootstrapStore((s) => s.setStage);
  const setProgress = useBootstrapStore((s) => s.setProgress);
  const setError = useBootstrapStore((s) => s.setError);
  const setSelf = useBootstrapStore((s) => s.setSelf);
  const aboutYouEmbeddingRef = useRef<Float32Array | null>(null);
  const containerRef = useRef<MobileContainer | null>(null);

  useEffect(() => {
    let cancelled = false;
    let disposeRecordHandler: (() => void) | null = null;

    const run = async (): Promise<void> => {
      try {
        setStage('identity');
        const c = await bootstrapMobile();
        if (cancelled) {
          return;
        }
        setSelf(c.self);
        containerRef.current = c;
        setContainerForReBucket(c);

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
        setAboutYouEmbeddingForReBucket(aboutYouEmbedding);

        // Load own posts' embeddings so the receiver-side similarity can
        // be computed against the user's actual posting history rather
        // than a static "About you" description.
        const ownFromDb = await c.posts.getOwnEmbeddings(
          c.self,
          MatchingConfig.embeddingDim,
        );
        externalOwnEmbeddings.current = ownFromDb;

        await rebucketAndJoin();

        // Sticky peers: re-establish direct connections to every peer we
        // have ever met. Survives About-you / bucket changes — once you
        // have connected to someone, you keep being connected to them via
        // a direct DHT lookup on their Hyperswarm noise key.
        try {
          const known = await c.peers.listNoiseKeys();
          for (const noiseKey of known) {
            try {
              await c.p2p.joinPeer(noiseKey);
            } catch (err) {
              console.warn('[rn] joinPeer failed', noiseKey.slice(0, 12), err);
            }
          }
          if (known.length > 0) {
            console.log(`[rn] sticky peers restored count=${known.length}`);
          }
        } catch (err) {
          console.warn('[rn] failed to restore sticky peers', err);
        }

        // Save the noise key of any peer we connect to, so the next boot
        // can dial them directly.
        c.p2p.onPeerNoise((peerId, noiseKey) => {
          void c.peers.setNoiseKey(peerId, noiseKey).catch((err) => {
            console.warn('[rn] setNoiseKey failed', err);
          });
        });

        // Single source of truth for incoming records: verify signature,
        // score against own posts, persist into SQLite. The Inbox/Thread
        // screens auto-refresh from SQLite on a setInterval.
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
 * similarity scorer AND by the post-driven bucket computation. Mutated in
 * place when the user composes a new post.
 *
 * Exposed via a module-level ref because the Compose screen needs to push
 * into it without going through the React tree.
 */
const externalOwnEmbeddings: { current: Float32Array[] } = { current: [] };

export function appendOwnEmbedding(v: Float32Array): void {
  externalOwnEmbeddings.current.push(v);
  // After publishing a new post, the bucket source may switch from
  // About-you to post-centroid (or update the centroid). Re-bucket and
  // diff so we leave dropped topics and join new ones without churn.
  void rebucketAndJoin().catch((err) => {
    console.warn('[rn] re-bucket after own post failed', err);
  });
}

export function getOwnEmbeddingsSnapshot(): Float32Array[] {
  return externalOwnEmbeddings.current;
}

// ----- Bucket state shared with the Settings screen --------------------------

/**
 * The L LSH buckets this device is currently joined to (Tier 2 multi-table).
 * Exposed for the Settings screen to surface as a diagnostic.
 */
const currentBucketsRef: { current: ReadonlyArray<BucketId> } = { current: [] };
const currentBucketSourceRef: { current: InterestVectorSource | null } = {
  current: null,
};

export function getCurrentBuckets(): ReadonlyArray<BucketId> {
  return currentBucketsRef.current;
}

export function getCurrentBucketSource(): InterestVectorSource | null {
  return currentBucketSourceRef.current;
}

/**
 * Back-compat for code that still asks for "the current bucket" — returns
 * the first table's bucket as a representative. Prefer
 * `getCurrentBuckets()` for new code.
 */
export function getCurrentBucket(): BucketId | null {
  const b = currentBucketsRef.current;
  return b.length === 0 ? null : b[0];
}

// Module-local refs so the post-publish re-bucket helper can act without
// reaching back through React context.
let reBucketContainer: MobileContainer | null = null;
let reBucketAboutYou: Float32Array | null = null;

function setContainerForReBucket(c: MobileContainer): void {
  reBucketContainer = c;
}
function setAboutYouEmbeddingForReBucket(v: Float32Array | null): void {
  reBucketAboutYou = v;
}

/**
 * Recompute the L bucket ids from the current interest vector (post
 * centroid if enough own posts, otherwise About-you) and diff against
 * what we are currently joined to. Leaves topics that are no longer in
 * the set, joins newly-added ones. No-op for tables whose bucket bits
 * did not change.
 */
async function rebucketAndJoin(): Promise<void> {
  const c = reBucketContainer;
  if (c === null) {
    return;
  }
  const ir = computeInterestVector({
    ownPostEmbeddings: externalOwnEmbeddings.current,
    aboutYouEmbedding: reBucketAboutYou,
    minOwnPosts: MatchingConfig.postDrivenMinOwnPosts,
    windowOwnPosts: MatchingConfig.postDrivenWindow,
  });
  if (ir === null) {
    console.warn('[rn] rebucketAndJoin: no interest vector available');
    return;
  }
  const next = lshBucketsOf(
    ir.vector,
    MatchingConfig.embeddingDim,
    MatchingConfig.lshBits,
    MatchingConfig.lshSeeds,
  );
  const previous = currentBucketsRef.current;
  const prevSet = new Set(previous);
  const nextSet = new Set(next);

  for (const b of previous) {
    if (!nextSet.has(b)) {
      try {
        await c.network.leaveBucket(b);
        console.log(`[rn] left bucket ${b}`);
      } catch (err) {
        console.warn('[rn] leaveBucket failed', b, err);
      }
    }
  }
  for (const b of next) {
    if (!prevSet.has(b)) {
      try {
        await c.network.joinBucket(b);
        console.log(`[rn] joined bucket ${b}`);
      } catch (err) {
        console.warn('[rn] joinBucket failed', b, err);
      }
    }
  }
  currentBucketsRef.current = next;
  currentBucketSourceRef.current = ir.source;
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

    // The post's body may carry the author's Hyperswarm noise key. If
    // so, dial it directly so we can receive their follow-ups even when
    // bucket co-membership drifts apart. This is the key insight of the
    // §11 "authorNoiseKey direct routing" design: discoverability stays
    // via buckets, deliverability moves to point-to-point.
    if (!isOwn) {
      const noiseKey = record.body.authorNoiseKey;
      if (typeof noiseKey === 'string' && noiseKey.length > 0) {
        void rememberAuthorNoiseKey(c, record.author, noiseKey);
      }
    }
  } else {
    await c.responses.upsert(address, record.author, record.feedIndex, record.body);
    console.log(`[rn] persisted response address=${address} author=${shortAuthor}`);
  }
  await c.peers.touch(record.author, c.clock.now());
}

async function rememberAuthorNoiseKey(
  c: MobileContainer,
  author: PeerId,
  noiseKey: string,
): Promise<void> {
  try {
    await c.peers.setNoiseKey(author, noiseKey);
    await c.p2p.joinPeer(noiseKey);
    console.log(
      `[rn] author noise-key dial author=${String(author).slice(0, 12)} noise=${noiseKey.slice(0, 12)}`,
    );
  } catch (err) {
    console.warn('[rn] rememberAuthorNoiseKey failed', err);
  }
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
