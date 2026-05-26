import type { BucketId } from '@core/domain/types';

/**
 * Locality-Sensitive Hashing via signed random hyperplanes.
 *
 * Given a fixed seed, we deterministically generate `bits` random unit
 * hyperplanes of dimension `dim`. For an input embedding, the i-th bit of
 * the output is `1` iff the dot product with the i-th hyperplane is >= 0.
 *
 * Vectors close in cosine distance fall into the same bucket with high
 * probability. Same seed across all peers => same hyperplanes => consistent
 * routing.
 *
 * Hyperplanes are cached on the first call with a given (dim, bits, seed).
 */

interface HyperplaneCacheKey {
  dim: number;
  bits: number;
  seed: number;
}

let cachedKey: HyperplaneCacheKey | null = null;
let cachedPlanes: Float32Array | null = null;

function planesFor(dim: number, bits: number, seed: number): Float32Array {
  if (
    cachedPlanes !== null &&
    cachedKey !== null &&
    cachedKey.dim === dim &&
    cachedKey.bits === bits &&
    cachedKey.seed === seed
  ) {
    return cachedPlanes;
  }
  const planes = new Float32Array(bits * dim);
  let state = seed >>> 0;
  // mulberry32 — small, deterministic, fast. Good enough for hashing.
  const rand = (): number => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  // Box-Muller for standard normal samples.
  for (let i = 0; i < bits; i++) {
    for (let j = 0; j < dim; j += 2) {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      planes[i * dim + j] = r * Math.cos(theta);
      if (j + 1 < dim) {
        planes[i * dim + j + 1] = r * Math.sin(theta);
      }
    }
  }
  cachedKey = { dim, bits, seed };
  cachedPlanes = planes;
  return planes;
}

function toHexBucketId(bits: number, bitValues: Uint8Array): BucketId {
  // Pack bits MSB-first into bytes, then hex.
  const byteLen = Math.ceil(bits / 8);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < bits; i++) {
    if (bitValues[i] === 1) {
      const byteIndex = (i / 8) | 0;
      const bitIndex = 7 - (i % 8);
      bytes[byteIndex] |= 1 << bitIndex;
    }
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    hex += (v >>> 4).toString(16);
    hex += (v & 0xf).toString(16);
  }
  return hex as BucketId;
}

export function lshBucketOf(
  embedding: Float32Array,
  dim: number,
  bits: number,
  seed: number,
): BucketId {
  if (embedding.length !== dim) {
    throw new Error(
      `lshBucketOf: embedding length ${embedding.length} != configured dim ${dim}`,
    );
  }
  const planes = planesFor(dim, bits, seed);
  const bitValues = new Uint8Array(bits);
  for (let b = 0; b < bits; b++) {
    let dot = 0;
    const base = b * dim;
    for (let j = 0; j < dim; j++) {
      dot += planes[base + j] * embedding[j];
    }
    bitValues[b] = dot >= 0 ? 1 : 0;
  }
  return toHexBucketId(bits, bitValues);
}
