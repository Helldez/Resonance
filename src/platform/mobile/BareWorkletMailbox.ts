import type { SignedRecord } from '@core/domain/types';
import type { IMailbox } from '@core/ports/IMailbox';
import type { P2pWorklet } from './P2pWorklet';

/**
 * The mailbox-as-port view of the local outbox. Append writes to the
 * Hypercore in the Bare worker; ingest is a no-op because remote records
 * arrive through `IPeerNetwork.onRecord` already — they are durably
 * stored in the SQLite projection by the sync engine.
 *
 * `iterate` is a future surface for backfill on cold start.
 */
export class BareWorkletMailbox implements IMailbox {
  constructor(private readonly worklet: P2pWorklet) {}

  async initialize(): Promise<void> {
    // P2pWorklet.initialize is owned by the network adapter.
  }

  async shutdown(): Promise<void> {}

  async append(record: SignedRecord): Promise<number> {
    return this.worklet.append(record);
  }

  async ingest(_record: SignedRecord): Promise<void> {
    // No-op for now: incoming records are routed through the network port
    // (`IPostNetwork.onRecord`) and persisted into SQLite by the
    // `AppContainerProvider` record handler.
  }

  async *iterate(): AsyncIterable<SignedRecord> {
    // Backfill from the local outbox is not exposed by the worker yet —
    // it lives in the Hypercore and can be re-read on demand.
    return;
  }
}
