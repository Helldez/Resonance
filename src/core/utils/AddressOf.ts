import type { PeerId, RecordAddress } from '@core/domain/types';

export function addressOf(author: PeerId, feedIndex: number): RecordAddress {
  return `${author}:${feedIndex}` as RecordAddress;
}
