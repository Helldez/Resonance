import { UMAP } from 'umap-js';
import { mulberry32 } from '@core/utils/SeededRng';
import { projectPca2 } from '@core/matching/Project2D';

/**
 * Project L2-normalised embeddings to a real 2-D layout where distance
 * carries meaning (semantic neighbours land near each other) — the basis of
 * the topic atlas, in the spirit of Nomic Atlas / BERTopic.
 *
 * Above `minPointsForUmap` we run UMAP for genuine manifold structure;
 * below it (too few neighbours to be stable) we fall back to the
 * deterministic 2-D PCA in `Project2D`. Either way the output is centred on
 * the origin and left unscaled — the caller rescales into the viewBox.
 *
 * Determinism: UMAP's randomness (init + negative sampling) is driven by a
 * seeded Mulberry32 generator, so the same posts produce the same picture on
 * a given engine. Floats are not bit-identical across JS engines (Hermes on
 * mobile vs V8 in Electron), which is fine — this is a per-device
 * visualisation, not replicated data.
 *
 * Since the vectors are unit length, Euclidean distance is monotonic in
 * cosine distance (‖a−b‖² = 2 − 2·cos), so UMAP's default Euclidean metric
 * yields the same neighbour graph as cosine without re-normalising.
 */
export interface AtlasProjectionOptions {
  readonly seed: number;
  /** Below this many points, skip UMAP and use the PCA-2 fallback. */
  readonly minPointsForUmap: number;
  readonly nNeighbors: number;
  readonly minDist: number;
  readonly spread: number;
  readonly nEpochs: number;
  /** Epochs run per cooperative yield, so the JS thread stays responsive. */
  readonly epochsPerBatch: number;
  /** Power-iteration count for the PCA fallback / init. */
  readonly powerIterations: number;
}

export interface Projection2D {
  readonly xs: Float32Array;
  readonly ys: Float32Array;
}

export async function projectAtlas(
  vectors: ReadonlyArray<Float32Array>,
  opts: AtlasProjectionOptions,
): Promise<Projection2D> {
  const n = vectors.length;
  if (n === 0) {
    return { xs: new Float32Array(0), ys: new Float32Array(0) };
  }
  // One or two points have no meaningful layout — and UMAP/PCA degenerate.
  if (n < opts.minPointsForUmap) {
    return centerInPlace(projectPca2(vectors, opts.powerIterations));
  }

  // umap-js consumes number[][]; convert from the Float32Array store once.
  const data: number[][] = vectors.map((v) => Array.from(v));
  const nNeighbors = Math.max(2, Math.min(opts.nNeighbors, n - 1));

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist: opts.minDist,
    spread: opts.spread,
    nEpochs: opts.nEpochs,
    random: mulberry32(opts.seed >>> 0),
  });

  // Stepwise optimisation: yield to the event loop every `epochsPerBatch`
  // epochs so gestures stay responsive while "Projecting…" is shown.
  const totalEpochs = umap.initializeFit(data);
  let epoch = 0;
  while (epoch < totalEpochs) {
    const end = Math.min(epoch + opts.epochsPerBatch, totalEpochs);
    while (epoch < end) {
      umap.step();
      epoch++;
    }
    await Promise.resolve();
  }

  const embedding = umap.getEmbedding();
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = embedding[i][0];
    ys[i] = embedding[i][1];
  }
  return centerInPlace({ xs, ys });
}

/** Shift the cloud so its centroid sits at the origin (mutates in place). */
function centerInPlace(p: Projection2D): Projection2D {
  const n = p.xs.length;
  if (n === 0) {
    return p;
  }
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += p.xs[i];
    my += p.ys[i];
  }
  mx /= n;
  my /= n;
  for (let i = 0; i < n; i++) {
    p.xs[i] -= mx;
    p.ys[i] -= my;
  }
  return p;
}
