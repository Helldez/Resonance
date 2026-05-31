import type {
  PeerId,
  ReactionBody,
  ReactionType,
  RecordAddress,
  SignedRecord,
} from '@core/domain/types';
import type { IClock } from '@core/ports/IClock';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IMailbox } from '@core/ports/IMailbox';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import { canonicalDigest, signRecord } from '@core/utils/CanonicalRecord';

export interface PublishReactionDeps {
  readonly mailbox: IMailbox;
  readonly network: IPeerNetwork;
  readonly identity: IIdentity;
  readonly clock: IClock;
  readonly self: PeerId;
}

export interface PublishReactionInput {
  /** The post or response being reacted to. */
  readonly inReplyTo: RecordAddress;
  readonly reaction: ReactionType;
}

/**
 * Emit a signed reaction to a post or response: build → sign → append to own
 * feed → publish. Mirrors `publishResponse`. Re-emitting a different reaction
 * type to the same target replaces the previous one on every receiver (the
 * `ReactionRepository` keeps the latest per author+target).
 */
export async function publishReaction(
  deps: PublishReactionDeps,
  input: PublishReactionInput,
): Promise<SignedRecord> {
  const body: ReactionBody = {
    kind: 'reaction',
    inReplyTo: input.inReplyTo,
    reaction: input.reaction,
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
