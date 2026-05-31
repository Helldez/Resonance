import type { PeerId, RecordAddress } from '@core/domain/types';
import { TopicConfig } from '@core/config/TopicConfig';
import { sphericalKMeans } from './SphericalKMeans';
import { projectAtlas } from './AtlasProjection';

/**
 * Build the global "topic atlas". The layout is a real 2-D projection of the
 * post embeddings (UMAP, or PCA-2 for small sets — see `AtlasProjection`), so
 * position carries meaning: semantically similar posts sit near each other
 * and dense regions read as topics, the way Nomic Atlas / BERTopic maps do.
 *
 * Spherical k-means (with k chosen by silhouette) groups posts only to assign
 * colours and a label anchor — never to place them. Each topic bubble is then
 * derived from the real coordinates of its members. Positions are rescaled to
 * `[-1, 1]` so the UI can drop them straight into the map viewBox.
 *
 * Async because the UMAP optimisation yields cooperatively. Deterministic for
 * a fixed input on a given engine. Labels start as the topic's medoid post
 * (the most central real post, truncated); the optional LLM naming pass
 * (`NameTopics`) replaces them later.
 */
export interface AtlasPostInput {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly embedding: Float32Array;
  readonly isOwn: boolean;
}

export interface AtlasTopic {
  readonly id: number;
  readonly count: number;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Short label shown on the map: the medoid post, truncated at a word. */
  readonly label: string;
  /** The full medoid post text, shown when the topic is tapped. */
  readonly labelFull: string;
  /**
   * The topic's most-central posts (by embedding centrality), capped at
   * `TopicConfig.naming.topKPosts`. The optional LLM naming pass reads these;
   * nothing else parses them, so naming stays embedding-driven (no keywords).
   */
  readonly centralTexts: ReadonlyArray<string>;
}

export interface AtlasPoint {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly topicId: number;
  readonly isOwn: boolean;
  readonly x: number;
  readonly y: number;
}

export interface TopicAtlasResult {
  readonly topics: ReadonlyArray<AtlasTopic>;
  readonly points: ReadonlyArray<AtlasPoint>;
  readonly k: number;
}

export interface ComputeTopicAtlasOptions {
  /** Override the auto-chosen topic count (still clamped to the data size). */
  readonly k?: number;
}

export async function computeTopicAtlas(
  posts: ReadonlyArray<AtlasPostInput>,
  opts: ComputeTopicAtlasOptions = {},
): Promise<TopicAtlasResult> {
  const n = posts.length;
  if (n === 0) {
    return { topics: [], points: [], k: 0 };
  }

  const embeddings = posts.map((p) => p.embedding);

  // 1. Cluster (colour + label anchors only) and 2. project (the layout) —
  //    independent of each other; both run on the embeddings.
  const { assignments, centroids, medoidIndices, k: usedK } = chooseClustering(
    embeddings,
    opts,
  );
  const { xs, ys } = await projectAtlas(embeddings, {
    seed: TopicConfig.kmeansSeed,
    ...TopicConfig.projection,
  });

  // Group member indices per cluster, ranked by closeness to the centroid so
  // the medoid is first and `centralTexts` are the most representative posts.
  const members: number[][] = [];
  for (let c = 0; c < usedK; c++) {
    members.push([]);
  }
  for (let i = 0; i < n; i++) {
    members[assignments[i]].push(i);
  }
  for (let c = 0; c < usedK; c++) {
    members[c].sort(
      (a, b) => dot(embeddings[b], centroids[c]) - dot(embeddings[a], centroids[c]),
    );
  }

  const { bubblePercentile, bubblePadding, bubbleMinRadius } = TopicConfig.projection;

  const topics: AtlasTopic[] = [];
  const points: AtlasPoint[] = [];

  // A reseed can still leave a cluster empty when n is barely above k.
  const visible: number[] = [];
  for (let c = 0; c < usedK; c++) {
    if (members[c].length > 0) {
      visible.push(c);
    }
  }

  visible.forEach((c) => {
    const arr = members[c];

    // Bubble centre/extent from the members' real projected coordinates.
    let cx = 0;
    let cy = 0;
    for (const idx of arr) {
      cx += xs[idx];
      cy += ys[idx];
    }
    cx /= arr.length;
    cy /= arr.length;

    const dists = arr
      .map((idx) => Math.hypot(xs[idx] - cx, ys[idx] - cy))
      .sort((a, b) => a - b);
    const r = Math.max(
      bubbleMinRadius,
      percentile(dists, bubblePercentile) + bubblePadding,
    );

    const medoid = medoidIndices[c];
    const labelIdx = medoid >= 0 ? medoid : arr[0];

    topics.push({
      id: c,
      count: arr.length,
      cx,
      cy,
      r,
      label: truncate(posts[labelIdx].text, TopicConfig.labelMaxChars),
      labelFull: posts[labelIdx].text.trim(),
      centralTexts: arr
        .slice(0, TopicConfig.naming.topKPosts)
        .map((idx) => posts[idx].text.trim()),
    });

    for (const idx of arr) {
      points.push({
        address: posts[idx].address,
        author: posts[idx].author,
        text: posts[idx].text,
        topicId: c,
        isOwn: posts[idx].isOwn,
        x: xs[idx],
        y: ys[idx],
      });
    }
  });

  return rescaleToUnit({ topics, points, k: visible.length });
}

interface Clustering {
  assignments: number[];
  centroids: Float32Array[];
  medoidIndices: number[];
  k: number;
}

/**
 * Pick a clustering for colours/labels. With an explicit `opts.k` we honour
 * it; otherwise we sweep k over [minTopics, maxTopics] and keep the one with
 * the best mean silhouette (cosine), so the data chooses its own granularity
 * instead of a fixed heuristic. Below `minPostsForClustering` everything is
 * one group.
 */
function chooseClustering(
  embeddings: ReadonlyArray<Float32Array>,
  opts: ComputeTopicAtlasOptions,
): Clustering {
  const n = embeddings.length;
  if (n < TopicConfig.minPostsForClustering) {
    return singleCluster(embeddings);
  }
  if (opts.k !== undefined) {
    const k = clamp(opts.k, 1, Math.min(TopicConfig.maxTopics, n));
    return k <= 1
      ? singleCluster(embeddings)
      : sphericalKMeans(embeddings, k, TopicConfig.kmeansIterations, TopicConfig.kmeansSeed);
  }

  const kLo = TopicConfig.minTopics;
  const kHi = Math.min(TopicConfig.maxTopics, n - 1);
  if (kHi < kLo) {
    return singleCluster(embeddings);
  }

  const dist = pairwiseCosineDistance(embeddings);
  let best: { score: number; res: Clustering } | null = null;
  for (let k = kLo; k <= kHi; k++) {
    const res = sphericalKMeans(
      embeddings,
      k,
      TopicConfig.kmeansIterations,
      TopicConfig.kmeansSeed,
    );
    const score = meanSilhouette(res.assignments, res.k, dist, n);
    if (best === null || score > best.score) {
      best = { score, res };
    }
  }
  // best is non-null: kHi >= kLo guarantees at least one iteration.
  return best === null ? singleCluster(embeddings) : best.res;
}

/** Dense n×n cosine-distance matrix (1 − dot on unit vectors), diagonal 0. */
function pairwiseCosineDistance(vs: ReadonlyArray<Float32Array>): Float32Array {
  const n = vs.length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - dot(vs[i], vs[j]);
      m[i * n + j] = d;
      m[j * n + i] = d;
    }
  }
  return m;
}

/**
 * Mean silhouette coefficient over all points (higher is better, in [-1, 1]).
 * Singleton clusters contribute 0 by convention.
 */
function meanSilhouette(
  assignments: ReadonlyArray<number>,
  k: number,
  dist: Float32Array,
  n: number,
): number {
  const sizes = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    sizes[assignments[i]] += 1;
  }
  let total = 0;
  const sumPer = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    sumPer.fill(0);
    const row = i * n;
    for (let j = 0; j < n; j++) {
      sumPer[assignments[j]] += dist[row + j];
    }
    const ci = assignments[i];
    if (sizes[ci] <= 1) {
      continue; // s(i) = 0
    }
    const a = sumPer[ci] / (sizes[ci] - 1);
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === ci || sizes[c] === 0) {
        continue;
      }
      const mean = sumPer[c] / sizes[c];
      if (mean < b) {
        b = mean;
      }
    }
    if (!Number.isFinite(b)) {
      continue; // only one non-empty cluster
    }
    const denom = Math.max(a, b);
    if (denom > 0) {
      total += (b - a) / denom;
    }
  }
  return total / n;
}

function singleCluster(embeddings: ReadonlyArray<Float32Array>): Clustering {
  const dim = embeddings[0].length;
  const sum = new Float32Array(dim);
  for (const v of embeddings) {
    for (let d = 0; d < dim; d++) {
      sum[d] += v[d];
    }
  }
  let norm = 0;
  for (let d = 0; d < dim; d++) {
    norm += sum[d] * sum[d];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let d = 0; d < dim; d++) {
      sum[d] /= norm;
    }
  }
  let medoid = 0;
  let best = -Infinity;
  for (let i = 0; i < embeddings.length; i++) {
    const d = dot(embeddings[i], sum);
    if (d > best) {
      best = d;
      medoid = i;
    }
  }
  return {
    assignments: new Array<number>(embeddings.length).fill(0),
    centroids: [sum],
    medoidIndices: [medoid],
    k: 1,
  };
}

/** Linear-interpolated percentile of a pre-sorted ascending array. */
function percentile(sortedAsc: ReadonlyArray<number>, p: number): number {
  const len = sortedAsc.length;
  if (len === 0) {
    return 0;
  }
  if (len === 1) {
    return sortedAsc[0];
  }
  const pos = clamp(p, 0, 1) * (len - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) {
    return sortedAsc[lo];
  }
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** Fit all bubble extents and points into [-1, 1] with a small margin. */
function rescaleToUnit(result: TopicAtlasResult): TopicAtlasResult {
  let maxAbs = 0;
  for (const t of result.topics) {
    maxAbs = Math.max(maxAbs, Math.abs(t.cx) + t.r, Math.abs(t.cy) + t.r);
  }
  for (const p of result.points) {
    maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  }
  const scale = maxAbs > 0 ? 0.98 / maxAbs : 1;
  return {
    k: result.k,
    topics: result.topics.map((t) => ({
      ...t,
      cx: t.cx * scale,
      cy: t.cy * scale,
      r: t.r * scale,
    })),
    points: result.points.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale })),
  };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  let cut = trimmed.slice(0, max - 1);
  // Prefer a word boundary so the label doesn't end mid-word, unless that
  // would shorten it drastically.
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > (max - 1) * 0.6) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.trimEnd() + '…';
}
