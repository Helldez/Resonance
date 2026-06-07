import type {
  PeerId,
  RecordAddress,
  ResponseBody,
  SignedRecord,
} from '@core/domain/types';
import type { IClock } from '@core/ports/IClock';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IMailbox } from '@core/ports/IMailbox';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import { canonicalDigest, signRecord } from '@core/utils/CanonicalRecord';
import { RoomConfig } from '@core/config/RoomConfig';

export interface PublishResponseDeps {
  readonly mailbox: IMailbox;
  readonly network: IPeerNetwork;
  readonly identity: IIdentity;
  readonly clock: IClock;
  readonly self: PeerId;
}

export interface PublishResponseInput {
  readonly text: string;
  readonly inReplyTo: RecordAddress;
}

export async function publishResponse(
  deps: PublishResponseDeps,
  input: PublishResponseInput,
): Promise<SignedRecord> {
  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    throw new Error('publishResponse: empty text');
  }
  if (trimmed.length > RoomConfig.maxResponseChars) {
    throw new Error(`publishResponse: text exceeds ${RoomConfig.maxResponseChars} chars`);
  }

  const body: ResponseBody = {
    kind: 'response',
    text: trimmed,
    inReplyTo: input.inReplyTo,
    createdAt: deps.clock.now(),
  };

  const digest = await canonicalDigest(body);
  const signature = await deps.identity.sign(digest);
  const feedIndex = await deps.mailbox.append({
    author: deps.self,
    feedIndex: -1,
    body,
    digest,
    signature,
  });
  const record = signRecord({
    author: deps.self,
    feedIndex,
    body,
    digest,
    signature,
  });
  await deps.network.publish(record);
  return record;
}
