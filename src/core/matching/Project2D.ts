import { cosineOnUnit } from './CosineSimilarity';
import type { RecordAddress } from '@core/domain/types';

export interface ProjectionInput {
  readonly address: RecordAddress;
  readonly embedding: Float32Array;
}

export interface Plotted2D {
  readonly address: RecordAddress;
  readonly x: number;
  readonly y: number;
  readonly similarityToAnchor: number;
}

export interface ProjectionResult {
  readonly anchor: Plotted2D;
  readonly peers: ReadonlyArray<Plotted2D>;
}

export type ProjectionMethod = 'pca-2' | 'radial-sim';

/**
 * Project a set of L2-normalised, equally-dimensioned vectors onto a 2D
 * plane, with `anchor` placed near the origin. Returns coordinates in
 * `[-1, 1]` after a global rescale. Deterministic for a fixed input.
 *
 * The 2D axes are the two leading principal directions of the candidate
 * set, computed via deflated power iteration. Picking PCA over UMAP/t-SNE
 * keeps this pure-TS, no nondeterminism, no native dependency — the
 * tradeoff is that highly non-linear clusters look flatter than they
 * would under a manifold method. Upgrade path: swap the body of this
 * function with a UMAP call once available in the worklet.
 */
/**
 * Map a raw cosine similarity to a radial distance in [0, 1] for the
 * radial-sim view, correcting for embedding anisotropy. Without the floor,
 * gemma-768's high baseline cosine (~0.3-0.5 even for unrelated text) collapses
 * every point toward the centre. We rescale `[floor, 1] → [0, 1]` so sim=1 is
 * the centre (r=0) and sim≤floor is the rim (r=1). Shared by the projector and
 * the map's reference rings so dots and ring labels line up.
 */
export function radiusForSimilarity(sim: number, floor: number): number {
  const denom = 1 - floor;
  const norm = denom > 0 ? (sim - floor) / denom : sim;
  return clamp01(1 - clamp01(norm));
}

export function projectToPlane(
  anchor: ProjectionInput,
  peers: ReadonlyArray<ProjectionInput>,
  method: ProjectionMethod,
  powerIterations: number,
  anisotropyFloor = 0,
): ProjectionResult {
  if (method !== 'pca-2' && method !== 'radial-sim') {
    throw new Error(`projectToPlane: unsupported method "${method}"`);
  }
  const dim = anchor.embedding.length;
  for (const p of peers) {
    if (p.embedding.length !== dim) {
      throw new Error(
        `projectToPlane: dimension mismatch (anchor=${dim}, peer=${p.embedding.length})`,
      );
    }
  }

  const all: ReadonlyArray<ProjectionInput> = [anchor, ...peers];
  const n = all.length;

  const { xs: xRaw, ys: yRaw } = projectPca2(
    all.map((item) => item.embedding),
    powerIterations,
  );

  if (method === 'pca-2') {
    const maxAbs = maxAbsBoth(xRaw, yRaw);
    const scale = maxAbs > 0 ? 1 / maxAbs : 1;
    const out: Plotted2D[] = [];
    for (let k = 0; k < n; k++) {
      const item = all[k];
      out.push({
        address: item.address,
        x: xRaw[k] * scale,
        y: yRaw[k] * scale,
        similarityToAnchor: cosineOnUnit(anchor.embedding, item.embedding),
      });
    }
    return { anchor: out[0], peers: out.slice(1) };
  }

  // radial-sim: distance from anchor is a direct function of cosine
  // similarity (closer = more similar). The angular position carries the
  // PCA structure so that two peers that are similar to each other end
  // up near each other on the rim, even when both sit at the same radial
  // distance from the anchor.
  const anchorX = xRaw[0];
  const anchorY = yRaw[0];
  const out: Plotted2D[] = [
    {
      address: all[0].address,
      x: 0,
      y: 0,
      similarityToAnchor: 1,
    },
  ];
  for (let k = 1; k < n; k++) {
    const item = all[k];
    const sim = cosineOnUnit(anchor.embedding, item.embedding);
    // Anisotropy-corrected radius (see radiusForSimilarity). When floor=0 this
    // reduces to the legacy `1 - sim` mapping.
    const r = radiusForSimilarity(sim, anisotropyFloor);
    const dx = xRaw[k] - anchorX;
    const dy = yRaw[k] - anchorY;
    const norm = Math.sqrt(dx * dx + dy * dy);
    const angle = norm > 0 ? Math.atan2(dy, dx) : stableAngleFromAddress(item.address);
    out.push({
      address: item.address,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      similarityToAnchor: sim,
    });
  }
  return { anchor: out[0], peers: out.slice(1) };
}

/**
 * Raw 2-D PCA projection of a set of equally-dimensioned vectors onto their
 * two leading principal directions (deflated power iteration). Centering
 * makes it translation-invariant; deterministic for a fixed input. Returns
 * the unscaled projected coordinates — callers rescale as they see fit
 * (e.g. the topic atlas uses this for both its small-N fallback and to
 * anchor the picture). `projectToPlane` builds on it.
 */
export function projectPca2(
  vectors: ReadonlyArray<Float32Array>,
  powerIterations: number,
): { readonly xs: Float32Array; readonly ys: Float32Array } {
  const n = vectors.length;
  if (n === 0) {
    return { xs: new Float32Array(0), ys: new Float32Array(0) };
  }
  const dim = vectors[0].length;

  const mean = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= n;
  }

  const centered: Float32Array[] = vectors.map((v) => {
    const c = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      c[i] = v[i] - mean[i];
    }
    return c;
  });

  const axis1 = powerIteration(centered, dim, powerIterations, null);
  const axis2 = powerIteration(centered, dim, powerIterations, axis1);

  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    xs[k] = dot(centered[k], axis1);
    ys[k] = dot(centered[k], axis2);
  }
  return { xs, ys };
}

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

/**
 * Deterministic fallback angle for peers whose PCA residual against the
 * anchor is zero (would-be NaN from atan2). We hash the address into a
 * stable angle in [0, 2π) so a re-projection of the same set produces
 * the same picture. No regex per AGENTS.md — char codes only.
 */
function stableAngleFromAddress(address: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h / 0xffffffff) * Math.PI * 2;
}

function powerIteration(
  centered: ReadonlyArray<Float32Array>,
  dim: number,
  iterations: number,
  deflate: Float32Array | null,
): Float32Array {
  let v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    v[i] = i === 0 ? 1 : 0;
  }
  if (deflate !== null) {
    orthogonalizeInPlace(v, deflate);
  }
  normalizeInPlace(v);

  for (let step = 0; step < iterations; step++) {
    const next = new Float32Array(dim);
    for (const c of centered) {
      const proj = dot(c, v);
      for (let i = 0; i < dim; i++) {
        next[i] += proj * c[i];
      }
    }
    if (deflate !== null) {
      orthogonalizeInPlace(next, deflate);
    }
    normalizeInPlace(next);
    v = next;
  }
  return v;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function normalizeInPlace(v: Float32Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i] * v[i];
  }
  const norm = Math.sqrt(s);
  if (norm <= 0) {
    return;
  }
  for (let i = 0; i < v.length; i++) {
    v[i] /= norm;
  }
}

function orthogonalizeInPlace(v: Float32Array, against: Float32Array): void {
  const proj = dot(v, against);
  for (let i = 0; i < v.length; i++) {
    v[i] -= proj * against[i];
  }
}

function maxAbsBoth(xs: Float32Array, ys: Float32Array): number {
  let m = 0;
  for (let i = 0; i < xs.length; i++) {
    const ax = Math.abs(xs[i]);
    const ay = Math.abs(ys[i]);
    if (ax > m) {
      m = ax;
    }
    if (ay > m) {
      m = ay;
    }
  }
  return m;
}
