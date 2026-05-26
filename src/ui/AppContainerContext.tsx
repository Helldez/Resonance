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

const FALLBACK_INTEREST_TEXT =
  'general interest in technology, life, and meaningful conversations';

export function AppContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<MobileContainer | null>(null);
  const setStage = useBootstrapStore((s) => s.setStage);
  const setProgress = useBootstrapStore((s) => s.setProgress);
  const setError = useBootstrapStore((s) => s.setError);
  const setSelf = useBootstrapStore((s) => s.setSelf);
  const inboxAdd = useInboxStore((s) => s.add);
  const interestProfileRef = useRef<Float32Array | null>(null);
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
          ? FALLBACK_INTEREST_TEXT
          : receiverContext;
        const interestProfile = await c.embedder.embed(interestText);
        interestProfileRef.current = interestProfile;

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
        // the Thread view. persistRecord uses the latest interest profile to
        // compute similarity, which is then stored alongside the post.
        c.network.onRecord((record) => {
          void persistRecord(c, record, interestProfileRef.current);
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

async function persistRecord(
  c: MobileContainer,
  record: import('@core/domain/types').SignedRecord,
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
    // Similarity is only meaningful for posts from OTHER peers. Our own posts
    // are stored with NULL similarity so they always show in the Inbox
    // regardless of threshold.
    const isOwn = record.author === c.self;
    let similarity: number | null = null;
    if (!isOwn && interestProfile !== null) {
      try {
        similarity = cosineOnUnit(record.body.embedding, interestProfile);
      } catch (e) {
        console.warn(`[rn] cosine failed for ${shortAuthor}`, e);
      }
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
