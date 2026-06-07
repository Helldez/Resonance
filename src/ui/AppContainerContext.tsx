import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PlatformContainer } from '@platform/bootstrap';
import { bootstrapPlatform } from '@platform/bootstrap';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useSettingsStore } from '@domain/SettingsStore';
import { useAgentProfileStore } from '@domain/AgentProfileStore';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { RoomConfig } from '@core/config/RoomConfig';
import type { ModelProgressUpdate } from '@qvac/sdk';
import {
  enqueueIngest,
  handleAnnouncement,
  persistRecord,
  getOwnEmbeddingsSnapshot,
  setOwnEmbeddings,
  rerankTier1AndPull,
} from '@services/NetworkIngestion';
import { createAgentScheduler } from '@services/AgentScheduler';

const AppContainerContext = createContext<PlatformContainer | null>(null);

/**
 * React shell around the app's runtime: boots the platform container, wires
 * the network handlers to the ingestion service, keeps the cold-start
 * "About you" embedding live, and arms the agent scheduler. All the actual
 * orchestration lives in `src/app-services/` — this file only owns the
 * React lifecycle.
 */
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
    let disposeAnnouncementHandler: (() => void) | null = null;

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
        setOwnEmbeddings(
          await c.posts.getOwnEmbeddingsWithAddress(c.self, MatchingConfig.embeddingDim),
        );

        // Self-heal: trim any over-capacity remainder from a previous session
        // back to the cap before new admissions are decided against it. The
        // evicted bodies are no longer held, so their Tier-1 `pulled` flags
        // reset and a future re-rank can fetch them again.
        const evicted = await c.posts.enforceRemoteCapacity(c.self, RoomConfig.inboxCapacity);
        for (const address of evicted) {
          await c.announcements.clearPulled(address);
        }
        if (evicted.length > 0) {
          console.log(`[rn] inbox trimmed ${evicted.length} over-capacity remote posts`);
        }
        // Heal Tier-1 flags orphaned by the old "downloaded once" semantics
        // (or by a crash between eviction and flag clear): a pulled=1 summary
        // with no held body can never win a re-rank, so reset it.
        const healed = await c.announcements.resetOrphanedPulledPosts();
        if (healed > 0) {
          console.log(`[rn] tier1 healed ${healed} orphaned pulled flags`);
        }

        // Single-room model: join the one shared room. There is no per-post
        // routing or bucket churn — Hyperswarm discovery plus directory
        // gossip carry every post to every peer.
        await c.network.joinRoom();
        console.log('[rn] joined single room');

        // Announce-then-pull. Two handlers:
        //  - onAnnouncement (high-volume): rank the lightweight summary locally,
        //    keep it in Tier-1, and pull the full body only if it earns a slot.
        //  - onRecord (bounded): a pulled body — verify its signature, re-score
        //    on the VERIFIED embedding, admit into the inbox, persist.
        disposeAnnouncementHandler = c.network.onAnnouncement((announcement) => {
          enqueueIngest(() =>
            handleAnnouncement(
              c,
              announcement,
              getOwnEmbeddingsSnapshot(),
              aboutYouEmbeddingRef.current,
            ),
          );
        });
        disposeRecordHandler = c.network.onRecord((record) => {
          enqueueIngest(() =>
            persistRecord(
              c,
              record,
              getOwnEmbeddingsSnapshot(),
              aboutYouEmbeddingRef.current,
            ),
          );
        });

        // Drain the backlog: a peer can connect during boot and the worker
        // emits each announcement only once, when first learned — so any that
        // arrived before the handlers above were attached would be lost. rescan
        // re-emits the full set of announcements the worker already knows, and
        // handleAnnouncement is idempotent, so this safely catches them up.
        await c.network.rescan();

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
      if (disposeAnnouncementHandler !== null) {
        disposeAnnouncementHandler();
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
    // Debounced: the Settings field updates the store per keystroke, and an
    // embed per character is wasted inference. Embed once typing pauses.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // Mirror the boot path: an empty "About you" means no interest signal,
          // so the embedding stays null and cold-start posts are not admitted.
          const embedding =
            receiverContext.trim().length === 0
              ? null
              : await c.embedder.embed(receiverContext);
          if (cancelled) {
            return;
          }
          aboutYouEmbeddingRef.current = embedding;
          console.log(
            `[rn] about-you embedding ${embedding === null ? 'cleared (no profile)' : 'refreshed'}`,
          );
          // The interest basis changed: re-rank Tier-1 so announcements that
          // were unscorable on a cold profile get pulled now, not at next boot.
          if (embedding !== null) {
            await rerankTier1AndPull(c, embedding);
          }
        } catch (e) {
          console.warn(
            `[rn] about-you re-embed failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      })();
    }, MatchingConfig.interestProfileDebounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [container, receiverContext]);

  // The autonomous agent loop, owned by the AgentScheduler service. Profile
  // reads go through getState() on each tick, so edits in "My agent" apply
  // without re-arming the timers.
  useEffect(() => {
    const c = containerRef.current;
    if (c === null || container === null) {
      return;
    }
    const scheduler = createAgentScheduler(c, () => {
      const { profile, killSwitch } = useAgentProfileStore.getState();
      return { profile, killSwitch };
    });
    return scheduler.start();
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
