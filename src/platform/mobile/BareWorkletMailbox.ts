import type { SignedRecord } from '@core/domain/types';
import type { IMailbox } from '@core/ports/IMailbox';

/**
 * Hypercore-backed personal feed, scheduled to live inside the Bare
 * worklet from M3 onward. Until the P2P worker is wired, this adapter
 * provides an in-memory mailbox so the single-device flow works.
 *
 * The append-order semantics and the `feedIndex` contract match what the
 * Hypercore-backed version will provide, so use cases written against
 * this stub keep working unchanged after the swap.
 */
export class BareWorkletMailbox implements IMailbox {
  private records: SignedRecord[] = [];
  private byAddress = new Map<string, number>();

  async initialize(): Promise<void> {
    // No-op until M3 swaps this for the Hypercore-backed implementation.
  }

  async shutdown(): Promise<void> {
    this.records = [];
    this.byAddress.clear();
  }

  async append(record: SignedRecord): Promise<number> {
    const feedIndex = this.records.length;
    const final: SignedRecord = { ...record, feedIndex };
    this.records.push(final);
    this.byAddress.set(`${record.author}:${feedIndex}`, feedIndex);
    return feedIndex;
  }

  async ingest(record: SignedRecord): Promise<void> {
    const key = `${record.author}:${record.feedIndex}`;
    if (this.byAddress.has(key)) {
      return;
    }
    this.byAddress.set(key, this.records.length);
    this.records.push(record);
  }

  async *iterate(): AsyncIterable<SignedRecord> {
    for (const r of this.records) {
      yield r;
    }
  }
}
