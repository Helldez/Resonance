import type { SignedRecord } from '@core/domain/types';

/**
 * The local persistent append-only feed of records we have produced or
 * received. Backed by Hypercore in the platform adapter.
 */
export interface IMailbox {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  /** Append a record we authored. Returns the feed index. */
  append(record: SignedRecord): Promise<number>;

  /** Store a record received from another peer. Idempotent. */
  ingest(record: SignedRecord): Promise<void>;

  /** Iterate all records in receive order. */
  iterate(): AsyncIterable<SignedRecord>;
}
