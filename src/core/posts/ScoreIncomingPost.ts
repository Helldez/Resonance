import type {
  PostBody,
  RecordAddress,
  ScoredPost,
  SignedRecord,
} from '@core/domain/types';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { addressOf } from '@core/utils/AddressOf';

export interface ScoreIncomingPostDeps {
  /**
   * The local user's interest profile, as a single L2-normalised vector in
   * the same space as post embeddings. For the MVP this is just the
   * embedding of the user's bio / interests string; later, the centroid of
   * the user's own past posts and explicit topic prefs.
   */
  readonly interestProfile: Float32Array;
}

/**
 * Decide whether an incoming post should land in the user's inbox, and
 * with what score. Returns `null` if the post is below threshold (silent
 * drop) or if the record is not a post.
 */
export function scoreIncomingPost(
  deps: ScoreIncomingPostDeps,
  record: SignedRecord,
): ScoredPost | null {
  if (record.body.kind !== 'post') {
    return null;
  }
  const post: PostBody = record.body;
  const similarity = cosineOnUnit(post.embedding, deps.interestProfile);
  if (similarity < MatchingConfig.inboxSimilarityThreshold) {
    return null;
  }
  const address: RecordAddress = addressOf(record.author, record.feedIndex);
  return {
    address,
    post,
    author: record.author,
    similarity,
  };
}
