import type { SignedRecord } from '@core/domain/types';
import type { IMailbox } from '@core/ports/IMailbox';
import type { DesktopP2pWorker } from './DesktopP2pWorker';

/**
 * Desktop counterpart of `BareWorkletMailbox`. Identical semantics:
 * append writes to the local Hypercore in the Bare subprocess, ingest is
 * a no-op (remote records are persisted through the network port +
 * SQLite projection), iterate is reserved for future backfill.
 */
export class DesktopMailbox implements IMailbox {
  constructor(private readonly worker: DesktopP2pWorker) {}

  async initialize(): Promise<void> {
    // DesktopP2pWorker.initialize is owned by the network adapter.
  }

  async shutdown(): Promise<void> {}

  async append(record: SignedRecord): Promise<number> {
    return this.worker.append(record);
  }

  async ingest(_record: SignedRecord): Promise<void> {
    // No-op: see BareWorkletMailbox for the rationale.
  }

  async *iterate(): AsyncIterable<SignedRecord> {
    return;
  }
}
