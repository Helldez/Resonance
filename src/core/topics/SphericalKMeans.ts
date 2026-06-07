/**
 * Spherical k-means for L2-normalised embeddings.
 *
 * Because every input vector has unit length, cosine similarity equals the
 * dot product, and the natural cluster centre is the *normalised* mean of a
 * cluster's members (the direction the members point on average). Assignment
 * is "nearest centroid by cosine" = "largest dot product".
 *
 * Pure and deterministic: k-means++ seeding uses a seeded Mulberry32 RNG
 * (the runtime forbids Math.random), so the same posts always yield the same
 * clusters. No text is involved — clustering is multilingual by construction.
 */
import { mulberry32 } from '@core/utils/SeededRng';

export interface KMeansResult {
  /** Cluster index per input vector. */
  readonly assignments: number[];
  /** Unit-length centroid direction per cluster. */
  readonly centroids: Float32Array[];
  /** Index of the most-central member (medoid) per cluster, or -1 if empty. */
  readonly medoidIndices: number[];
  readonly k: number;
}

export function sphericalKMeans(
  vectors: ReadonlyArray<Float32Array>,
  k: number,
  iterations: number,
  seed: number,
): KMeansResult {
  const n = vectors.length;
  if (n === 0) {
    return { assignments: [], centroids: [], medoidIndices: [], k: 0 };
  }
  const dim = vectors[0].length;
  const effectiveK = Math.max(1, Math.min(k, n));
  const rng = mulberry32(seed >>> 0);

  let centroids = kmeansPlusPlusInit(vectors, effectiveK, rng);
  let assignments = new Array<number>(n).fill(0);

  for (let step = 0; step < iterations; step++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const best = nearestCentroid(vectors[i], centroids);
      if (best !== assignments[i]) {
        assignments[i] = best;
        changed = true;
      }
    }
    const next = recomputeCentroids(vectors, assignments, effectiveK, dim);
    // Reseed any empty cluster to the point currently worst-served by its
    // centroid, so k stays meaningful instead of collapsing.
    for (let c = 0; c < effectiveK; c++) {
      if (next[c] === null) {
        const idx = worstServedPoint(vectors, assignments, centroids);
        next[c] = cloneUnit(vectors[idx]);
        assignments[idx] = c;
      }
    }
    centroids = next as Float32Array[];
    if (!changed && step > 0) {
      break;
    }
  }

  const medoidIndices = computeMedoids(vectors, assignments, centroids, effectiveK);
  return { assignments, centroids, medoidIndices, k: effectiveK };
}

function nearestCentroid(v: Float32Array, centroids: ReadonlyArray<Float32Array>): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = dot(v, centroids[c]);
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }
  return best;
}

function recomputeCentroids(
  vectors: ReadonlyArray<Float32Array>,
  assignments: ReadonlyArray<number>,
  k: number,
  dim: number,
): Array<Float32Array | null> {
  const sums: Float32Array[] = [];
  const counts = new Array<number>(k).fill(0);
  for (let c = 0; c < k; c++) {
    sums.push(new Float32Array(dim));
  }
  for (let i = 0; i < vectors.length; i++) {
    const c = assignments[i];
    const v = vectors[i];
    const s = sums[c];
    for (let d = 0; d < dim; d++) {
      s[d] += v[d];
    }
    counts[c] += 1;
  }
  const out: Array<Float32Array | null> = [];
  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) {
      out.push(null);
      continue;
    }
    out.push(normalize(sums[c]));
  }
  return out;
}

function worstServedPoint(
  vectors: ReadonlyArray<Float32Array>,
  assignments: ReadonlyArray<number>,
  centroids: ReadonlyArray<Float32Array>,
): number {
  let worst = 0;
  let worstDot = Infinity;
  for (let i = 0; i < vectors.length; i++) {
    const d = dot(vectors[i], centroids[assignments[i]]);
    if (d < worstDot) {
      worstDot = d;
      worst = i;
    }
  }
  return worst;
}

function computeMedoids(
  vectors: ReadonlyArray<Float32Array>,
  assignments: ReadonlyArray<number>,
  centroids: ReadonlyArray<Float32Array>,
  k: number,
): number[] {
  const bestDot = new Array<number>(k).fill(-Infinity);
  const medoid = new Array<number>(k).fill(-1);
  for (let i = 0; i < vectors.length; i++) {
    const c = assignments[i];
    const d = dot(vectors[i], centroids[c]);
    if (d > bestDot[c]) {
      bestDot[c] = d;
      medoid[c] = i;
    }
  }
  return medoid;
}

function kmeansPlusPlusInit(
  vectors: ReadonlyArray<Float32Array>,
  k: number,
  rng: () => number,
): Float32Array[] {
  const n = vectors.length;
  const chosen: Float32Array[] = [];
  const firstIdx = Math.floor(rng() * n) % n;
  chosen.push(cloneUnit(vectors[firstIdx]));

  while (chosen.length < k) {
    // D(x)^2 weighting where distance = 1 - max cosine to a chosen centroid.
    const weights = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let maxDot = -Infinity;
      for (const c of chosen) {
        const d = dot(vectors[i], c);
        if (d > maxDot) {
          maxDot = d;
        }
      }
      const dist = 1 - maxDot;
      const w = dist * dist;
      weights[i] = w;
      total += w;
    }
    if (total <= 0) {
      // All points already coincide with a centroid — pad with the first.
      chosen.push(cloneUnit(vectors[0]));
      continue;
    }
    let target = rng() * total;
    let pick = 0;
    for (let i = 0; i < n; i++) {
      target -= weights[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    chosen.push(cloneUnit(vectors[pick]));
  }
  return chosen;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i] * v[i];
  }
  const norm = Math.sqrt(s);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) {
      v[i] /= norm;
    }
  }
  return v;
}

function cloneUnit(v: Float32Array): Float32Array {
  return normalize(new Float32Array(v));
}
