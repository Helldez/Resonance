/**
 * In-place L2 normalisation. After this, the vector lies on the unit
 * hypersphere and cosine similarity reduces to a plain dot product.
 *
 * A zero vector is returned unchanged (no division by zero); callers
 * should treat that as an error condition further up.
 */
export function l2NormalizeInPlace(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  if (sumSq === 0) {
    return v;
  }
  const inv = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < v.length; i++) {
    v[i] = v[i] * inv;
  }
  return v;
}
