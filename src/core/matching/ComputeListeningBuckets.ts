import type { BucketId } from '@core/domain/types';
import { lshBucketOf, lshBucketsOf } from './LshBucket';
import { centroidL2 } from './InterestVector';

/**
 * Decide which Hyperswarm buckets a peer should subscribe to in order to
 * receive posts from semantically affine peers.
 *
 * The strategy is "per-post first, centroid fill second":
 *
 *  1. For each of the user's most recent own posts (capped at
 *     `windowOwnPosts`), compute the same single-seed bucket the post was
 *     published under (`lshBucketOf` with `singleSeed`). This anchors the
 *     listener in the literal semantic neighbourhoods of the user's own
 *     posts — symmetric to publishing — so any peer whose post landed in
 *     the same neighbourhood becomes reachable.
 *  2. Deduplicate while preserving order. Two posts on closely related
 *     topics may hash to the same bucket; that's intended.
 *  3. If after dedup we have fewer than `targetBuckets` distinct buckets
 *     (e.g. mono-thematic user whose 10 posts collapse to 1-2 buckets),
 *     compute the multi-table buckets of the centroid (or of the
 *     about-you embedding in cold start) and fill the remaining slots
 *     with those, in order. The multi-table family restores the classical
 *     LSH recall guarantee (~83% at cos_sim 0.85 with 8 tables) when the
 *     per-post coverage is too sparse.
 *  4. Cold start (zero own posts): start from the about-you bucket
 *     (single-seed) and fill from about-you multi-table buckets.
 *  5. No own posts and no about-you embedding: return an empty result —
 *     the caller can decide to stay disconnected until one of the two is
 *     available.
 *
 * The two namespaces (per-post raw hex vs `tNN-` prefixed multi-table)
 * never collide by construction, so the dedup is a plain string compare.
 *
 * Diagnostics are returned alongside so the call site can log the
 * routing decision in full detail.
 */
export interface ComputeListeningBucketsInput {
  readonly ownPostEmbeddings: ReadonlyArray<Float32Array>;
  readonly aboutYouEmbedding: Float32Array | null;
  readonly dim: number;
  readonly bits: number;
  readonly singleSeed: number;
  readonly multiSeeds: ReadonlyArray<number>;
  readonly windowOwnPosts: number;
  readonly targetBuckets: number;
}

export type ListeningBucketsSource =
  | { readonly kind: 'per-post-only'; readonly postsConsidered: number }
  | {
      readonly kind: 'per-post-plus-centroid-fill';
      readonly postsConsidered: number;
      readonly filled: number;
    }
  | { readonly kind: 'about-you-plus-fill'; readonly filled: number }
  | { readonly kind: 'about-you-only' }
  | { readonly kind: 'none' };

export interface ListeningBucketsDiagnostics {
  readonly perPostBucketsRaw: ReadonlyArray<BucketId>;
  readonly perPostDistinct: number;
  readonly filledFromCentroid: number;
  readonly source: ListeningBucketsSource;
}

export interface ComputeListeningBucketsResult {
  readonly buckets: ReadonlyArray<BucketId>;
  readonly diagnostics: ListeningBucketsDiagnostics;
}

export function computeListeningBuckets(
  input: ComputeListeningBucketsInput,
): ComputeListeningBucketsResult {
  const {
    ownPostEmbeddings,
    aboutYouEmbedding,
    dim,
    bits,
    singleSeed,
    multiSeeds,
    windowOwnPosts,
    targetBuckets,
  } = input;

  if (windowOwnPosts <= 0) {
    throw new Error('computeListeningBuckets: windowOwnPosts must be > 0');
  }
  if (targetBuckets <= 0) {
    throw new Error('computeListeningBuckets: targetBuckets must be > 0');
  }

  const take = Math.min(ownPostEmbeddings.length, windowOwnPosts);
  const recent =
    take === 0
      ? []
      : ownPostEmbeddings.slice(ownPostEmbeddings.length - take);

  const perPostRaw: BucketId[] = [];
  for (const post of recent) {
    perPostRaw.push(lshBucketOf(post, dim, bits, singleSeed));
  }

  const distinct: BucketId[] = [];
  for (const b of perPostRaw) {
    if (!distinct.includes(b)) {
      distinct.push(b);
    }
  }

  if (distinct.length === 0 && aboutYouEmbedding !== null) {
    distinct.push(lshBucketOf(aboutYouEmbedding, dim, bits, singleSeed));
  }

  if (distinct.length === 0) {
    return {
      buckets: [],
      diagnostics: {
        perPostBucketsRaw: perPostRaw,
        perPostDistinct: 0,
        filledFromCentroid: 0,
        source: { kind: 'none' },
      },
    };
  }

  let filled = 0;
  if (distinct.length < targetBuckets) {
    const anchor = recent.length > 0 ? centroidL2(recent) : aboutYouEmbedding;
    if (anchor !== null) {
      const multi = lshBucketsOf(anchor, dim, bits, multiSeeds);
      for (const b of multi) {
        if (distinct.length >= targetBuckets) {
          break;
        }
        if (!distinct.includes(b)) {
          distinct.push(b);
          filled += 1;
        }
      }
    }
  }

  const source = resolveSource(recent.length, distinct.length, filled);

  return {
    buckets: distinct,
    diagnostics: {
      perPostBucketsRaw: perPostRaw,
      perPostDistinct: perPostRaw.length === 0 ? 0 : distinctCount(perPostRaw),
      filledFromCentroid: filled,
      source,
    },
  };
}

function distinctCount(list: ReadonlyArray<BucketId>): number {
  const seen: BucketId[] = [];
  for (const b of list) {
    if (!seen.includes(b)) {
      seen.push(b);
    }
  }
  return seen.length;
}

function resolveSource(
  postsConsidered: number,
  finalCount: number,
  filled: number,
): ListeningBucketsSource {
  if (postsConsidered === 0) {
    if (filled > 0) {
      return { kind: 'about-you-plus-fill', filled };
    }
    return { kind: 'about-you-only' };
  }
  if (filled > 0) {
    return { kind: 'per-post-plus-centroid-fill', postsConsidered, filled };
  }
  if (finalCount > 0) {
    return { kind: 'per-post-only', postsConsidered };
  }
  return { kind: 'none' };
}
