import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MobileContainer } from '@platform/mobile/bootstrap';
import { bootstrapMobile } from '@platform/mobile/bootstrap';
import { useBootstrapStore } from '@domain/BootstrapStore';
import type { ModelProgressUpdate } from '@qvac/sdk';

const AppContainerContext = createContext<MobileContainer | null>(null);

export function AppContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<MobileContainer | null>(null);
  const setStage = useBootstrapStore((s) => s.setStage);
  const setProgress = useBootstrapStore((s) => s.setProgress);
  const setError = useBootstrapStore((s) => s.setError);
  const setSelf = useBootstrapStore((s) => s.setSelf);

  useEffect(() => {
    let cancelled = false;
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

        // LLM is loaded lazily on first draft, not at boot.
        setStage('network');
        // M3 will wire the swarm here.

        setStage('ready');
        setContainer(c);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [setStage, setProgress, setError, setSelf]);

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
