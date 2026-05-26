import type { ScoredPost, SignedRecord } from '@core/domain/types';
import type { IMailbox } from '@core/ports/IMailbox';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import { scoreIncomingPost } from '@core/posts/ScoreIncomingPost';

export interface SyncEngineDeps {
  readonly network: IPeerNetwork;
  readonly mailbox: IMailbox;
  /** Returns the current user's interest profile (may change over time). */
  readonly getInterestProfile: () => Float32Array;
  /** Called whenever a new post passes the local similarity threshold. */
  readonly onInboxItem: (scored: ScoredPost) => void;
}

export interface SyncEngineHandle {
  stop(): void;
}

/**
 * Wire the network's incoming-record event to mailbox ingestion and inbox
 * scoring. Pure orchestration — no I/O of its own.
 */
export function startSyncEngine(deps: SyncEngineDeps): SyncEngineHandle {
  const dispose = deps.network.onRecord(async (record: SignedRecord) => {
    await deps.mailbox.ingest(record);
    if (record.body.kind !== 'post') {
      return;
    }
    const scored = scoreIncomingPost(
      { interestProfile: deps.getInterestProfile() },
      record,
    );
    if (scored !== null) {
      deps.onInboxItem(scored);
    }
  });
  return {
    stop: () => dispose(),
  };
}
