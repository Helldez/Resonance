import type { RecordAddress } from '@core/domain/types';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';

/** An own-post embedding tagged with the address of the post it came from. */
export interface OwnEmbedding {
  readonly address: RecordAddress;
  readonly embedding: Float32Array;
}

export interface OwnScore {
  /** MAX cosine vs own posts, or the About-you fallback; null if unscorable. */
  readonly similarity: number | null;
  /**
   * Address of the own post that produced the MAX cosine, so the inbox can
   * group the candidate beneath it. Null on the cold-start (About-you) path.
   */
  readonly matchedOwnAddress: RecordAddress | null;
}

/**
 * Receiver-side relevance score for an incoming embedding.
 *
 * Primary signal: the MAX cosine against the user's own post embeddings — what
 * the user has actually written about is a stronger signal than what they
 * declared in "About you". Also reports which own post won, so the inbox can
 * group the candidate under it.
 *
 * Cold-start fallback: cosine against the interest profile (the "About you"
 * embedding), used until the user has at least one post; the matched address is
 * null because there is no own post to attribute it to.
 *
 * `similarity` is null only when neither signal is available. Pure: extracted
 * from the old `AppContainerContext.scoreRemotePost` so the announce ingest and
 * the re-rank pass share one scorer. Dimension-mismatched own vectors are
 * skipped (a stale embedding from a previous model).
 */
export function scoreAgainstOwn(
  embedding: Float32Array,
  ownEmbeddings: ReadonlyArray<OwnEmbedding>,
  interestProfile: Float32Array | null,
): OwnScore {
  if (ownEmbeddings.length > 0) {
    let best = -Infinity;
    let bestIndex = -1;
    for (let i = 0; i < ownEmbeddings.length; i++) {
      try {
        const s = cosineOnUnit(embedding, ownEmbeddings[i].embedding);
        if (s > best) {
          best = s;
          bestIndex = i;
        }
      } catch {
        // dimension mismatch on a stale embedding — skip it
      }
    }
    if (bestIndex >= 0) {
      return { similarity: best, matchedOwnAddress: ownEmbeddings[bestIndex].address };
    }
  }
  if (interestProfile !== null) {
    try {
      return { similarity: cosineOnUnit(embedding, interestProfile), matchedOwnAddress: null };
    } catch {
      return { similarity: null, matchedOwnAddress: null };
    }
  }
  return { similarity: null, matchedOwnAddress: null };
}
