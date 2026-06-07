import { useCallback, useState } from 'react';
import type { PlatformContainer } from '@platform/PlatformContainer';

export interface ModelDownload {
  readonly ready: boolean;
  readonly loading: boolean;
  readonly progress: { downloaded: number; total: number } | null;
  readonly error: string | null;
  start(): void;
}

/**
 * The LLM download/load state machine behind the three-state model row
 * (button → inline progress → ready badge), shared by Settings and the
 * onboarding agent step. Pass `null` while the container is still booting —
 * `ready` stays false and `start` is a no-op until it arrives.
 */
export function useModelDownload(
  container: PlatformContainer | null,
  sizeBytes: number,
): ModelDownload {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(container?.llmConcrete.isLoaded ?? false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback((): void => {
    if (container === null || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    setProgress({ downloaded: 0, total: sizeBytes });
    void (async () => {
      try {
        await container.llmConcrete.load((p) => {
          setProgress({ downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
        });
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [container, loading, sizeBytes]);

  return {
    ready: ready || (container?.llmConcrete.isLoaded ?? false),
    loading,
    progress,
    error,
    start,
  };
}
