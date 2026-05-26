import type {
  PeerId,
  PostBody,
  SignedRecord,
} from '@core/domain/types';
import type { IClock } from '@core/ports/IClock';
import type { IEmbeddingService } from '@core/ports/IEmbeddingService';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IMailbox } from '@core/ports/IMailbox';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import { lshBucketOf } from '@core/matching/LshBucket';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { canonicalDigest, signRecord } from '@core/utils/CanonicalRecord';

export interface CreatePostDeps {
  readonly embedder: IEmbeddingService;
  readonly mailbox: IMailbox;
  readonly network: IPeerNetwork;
  readonly identity: IIdentity;
  readonly clock: IClock;
  readonly self: PeerId;
}

export interface CreatePostInput {
  readonly text: string;
}

export interface CreatePostResult {
  readonly record: SignedRecord;
}

/**
 * Author a new post: embed → compute bucket → join swarm → sign → append to
 * own feed. The published record propagates through Hypercore replication.
 */
export async function createPost(
  deps: CreatePostDeps,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    throw new Error('createPost: empty text');
  }

  const embedding = await deps.embedder.embed(trimmed);

  const bucket = lshBucketOf(
    embedding,
    MatchingConfig.embeddingDim,
    MatchingConfig.lshBits,
    MatchingConfig.lshSeed,
  );

  await deps.network.joinBucket(bucket);

  const body: PostBody = {
    kind: 'post',
    text: trimmed,
    embedding,
    bucket,
    createdAt: deps.clock.now(),
  };

  const digest = await canonicalDigest(body);
  const signature = await deps.identity.sign(digest);
  const feedIndex = await deps.mailbox.append({
    author: deps.self,
    feedIndex: -1, // assigned by mailbox; we fill it back below
    body,
    digest,
    signature,
  });

  const record: SignedRecord = signRecord({
    author: deps.self,
    feedIndex,
    body,
    digest,
    signature,
  });
  await deps.network.publish(record);
  return { record };
}
