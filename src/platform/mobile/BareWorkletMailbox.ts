import type { SignedRecord } from '@core/domain/types';
import type { IMailbox } from '@core/ports/IMailbox';

/**
 * Hypercore-backed personal feed, lives inside the Bare worklet. This class
 * is the RN-side facade that talks to the worklet via RPC.
 *
 * Stub for now — wired in Milestone 2.
 */
export class BareWorkletMailbox implements IMailbox {
  async initialize(): Promise<void> {
    // TODO M2
  }
  async shutdown(): Promise<void> {
    // TODO M2
  }
  async append(_record: SignedRecord): Promise<number> {
    throw new Error('BareWorkletMailbox.append: not implemented (M2)');
  }
  async ingest(_record: SignedRecord): Promise<void> {
    throw new Error('BareWorkletMailbox.ingest: not implemented (M2)');
  }
  async *iterate(): AsyncIterable<SignedRecord> {
    throw new Error('BareWorkletMailbox.iterate: not implemented (M2)');
  }
}
