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
 * Author a new post: embed → sign → append to own feed. In the single-room
 * model there is no per-post routing: the peer already joined the one shared
 * room at boot, and the appended record propagates to peers through
 * Hypercore replication + directory gossip.
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
  console.log(
    `[rn] createPost textLen=${trimmed.length} embDim=${embedding.length}`,
  );

  const body: PostBody = {
    kind: 'post',
    text: trimmed,
    embedding,
    createdAt: deps.clock.now(),
  };

  const digest = await canonicalDigest(body);
  const signature = await deps.identity.sign(digest);

  // The mailbox assigns the authoritative feed index; we fold it back into
  // the final record so consumers (UI, network) see a consistent shape.
  const provisional: SignedRecord = {
    author: deps.self,
    feedIndex: -1,
    body,
    digest,
    signature,
  };
  const feedIndex = await deps.mailbox.append(provisional);

  const record: SignedRecord = signRecord({
    ...provisional,
    feedIndex,
  });
  try {
    await deps.network.publish(record);
  } catch {
    // Publishing is best-effort at MVP; the record is durable in the
    // mailbox and will be re-broadcast on the next sync cycle. Surfacing
    // this as a hard error would break the single-device flow before M3.
  }
  return { record };
}
