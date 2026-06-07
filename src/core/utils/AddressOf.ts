import type { PeerId, RecordAddress } from '@core/domain/types';

export function addressOf(author: PeerId, feedIndex: number): RecordAddress {
  return `${author}:${feedIndex}` as RecordAddress;
}

/**
 * Inverse of `addressOf`. Peer ids are hex strings and never contain ':',
 * so the last separator is unambiguous. Throws on a malformed address —
 * addresses passed here come from our own storage, so a failure is a bug,
 * not untrusted input.
 */
export function parseAddress(address: RecordAddress): { author: PeerId; feedIndex: number } {
  const sep = address.lastIndexOf(':');
  const feedIndex = Number(address.slice(sep + 1));
  if (sep <= 0 || !Number.isInteger(feedIndex) || feedIndex < 0) {
    throw new Error(`malformed record address: ${address}`);
  }
  return { author: address.slice(0, sep) as PeerId, feedIndex };
}
