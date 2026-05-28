import { l2NormalizeInPlace } from './L2Normalize';

/**
 * Compute the "interest vector" the LSH tables should embed for bucket
 * membership. Two regimes:
 *
 *  1. Cold start — fewer than `minOwnPosts` own posts in the local DB.
 *     Fall back to the embedding of the user's "About you" text (or a
 *     generic fallback string if that is empty too). This is what gets
 *     a brand-new account into a sensible bucket immediately.
 *
 *  2. Post-driven — once the user has written `minOwnPosts` posts, the
 *     interest vector becomes the L2-normalised mean (centroid) of the
 *     most recent `windowOwnPosts` own embeddings. The user's bucket
 *     membership now evolves with what they actually write, not what
 *     they declared they cared about. This is the §7 open question in
 *     `docs/SEMANTIC_ROUTING.md` answered "post-driven".
 *
 * Returns the (L2-normalised) interest vector plus a tag describing
 * which regime produced it, so the UI / logs can show whether the user
 * is still in cold start.
 */
export interface InterestVectorInput {
  readonly ownPostEmbeddings: ReadonlyArray<Float32Array>;
  readonly aboutYouEmbedding: Float32Array | null;
  readonly minOwnPosts: number;
  readonly windowOwnPosts: number;
}

export type InterestVectorSource =
  | { readonly kind: 'post-centroid'; readonly fromPosts: number }
  | { readonly kind: 'about-you' }
  | { readonly kind: 'none' };

export interface InterestVectorResult {
  readonly vector: Float32Array;
  readonly source: InterestVectorSource;
}

export function computeInterestVector(
  input: InterestVectorInput,
): InterestVectorResult | null {
  const posts = input.ownPostEmbeddings;
  if (posts.length >= input.minOwnPosts) {
    const take = Math.min(posts.length, input.windowOwnPosts);
    const recent = posts.slice(posts.length - take);
    const centroid = centroidL2(recent);
    return {
      vector: centroid,
      source: { kind: 'post-centroid', fromPosts: take },
    };
  }
  if (input.aboutYouEmbedding !== null) {
    return {
      vector: input.aboutYouEmbedding,
      source: { kind: 'about-you' },
    };
  }
  return null;
}

/**
 * L2-normalised arithmetic mean of a set of equally-dimensioned vectors.
 * Throws on empty input or dim mismatch. Exported because the LSH listening
 * pipeline (`ComputeListeningBuckets`) uses the same anchor when it needs
 * to fill remaining slots with multi-table buckets.
 */
export function centroidL2(vectors: ReadonlyArray<Float32Array>): Float32Array {
  if (vectors.length === 0) {
    throw new Error('centroidL2: empty input');
  }
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(
        `centroidL2: dimension mismatch (expected ${dim}, got ${v.length})`,
      );
    }
    for (let i = 0; i < dim; i++) {
      out[i] += v[i];
    }
  }
  const n = vectors.length;
  for (let i = 0; i < dim; i++) {
    out[i] /= n;
  }
  return l2NormalizeInPlace(out);
}
