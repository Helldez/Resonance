import { useCallback, useEffect, useState } from 'react';
import type { PlatformContainer } from '@platform/PlatformContainer';
import { MatchingConfig } from '@core/config/MatchingConfig';

/**
 * Live count of agent drafts awaiting approval — drives the badge on the
 * Agent tab. Polls on the UI refresh cadence; cheap (a COUNT(*) on a queue
 * that is small by construction).
 */
export function usePendingCount(container: PlatformContainer | null): number {
  const [count, setCount] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    if (container === null) {
      return;
    }
    setCount(await container.pending.count());
  }, [container]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, MatchingConfig.uiRefreshIntervalMs);
    return () => clearInterval(id);
  }, [load]);

  return count;
}
