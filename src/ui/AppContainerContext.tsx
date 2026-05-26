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
        // the Thread view. The SyncEngine already routes new posts through
        // onInboxItem above; here we additionally observe responses.
        c.network.onRecord((record) => {
          void persistRecord(c, record);
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
): Promise<void> {
  // Verify signature before trusting the record.
  const expectedDigest = await canonicalDigest(record.body);
  if (!bytesEqual(expectedDigest, record.digest)) {
    return;
  }
  const sigOk = await c.identity.verify(record.digest, record.signature, record.author);
  if (!sigOk) {
    return;
  }
  const address = addressOf(record.author, record.feedIndex);
  if (record.body.kind === 'post') {
    await c.posts.upsert(address, record.author, record.feedIndex, record.body, null);
  } else {
    await c.responses.upsert(address, record.author, record.feedIndex, record.body);
  }
  await c.peers.touch(record.author, c.clock.now());
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
