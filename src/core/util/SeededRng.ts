/**
 * Deterministic 32-bit PRNG (Mulberry32). Same seed → same sequence.
 *
 * The runtime forbids `Math.random` so every stochastic step in the core
 * (k-means++ seeding, the UMAP atlas projection's init and negative
 * sampling) draws from a seeded generator instead, keeping results
 * reproducible and snapshot-testable.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
