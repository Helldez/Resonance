/**
 * Shared little-endian Float32 ⇄ BLOB codec for embeddings stored in SQLite.
 *
 * Embeddings are persisted as the raw bytes of a `Float32Array` (native LE byte
 * order, no header). `decodeEmbedding` validates the byte length against the
 * active model's dimension and returns `null` on mismatch, so a stale vector
 * from a previous model never reaches the cosine math.
 */

export function floatToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

export function decodeEmbedding(
  blob: Uint8Array | null | undefined,
  expectedDim: number,
): Float32Array | null {
  if (blob === null || blob === undefined) {
    return null;
  }
  const expectedBytes = expectedDim * Float32Array.BYTES_PER_ELEMENT;
  if (blob.byteLength !== expectedBytes) {
    return null;
  }
  return new Float32Array(blob.buffer, blob.byteOffset, expectedDim);
}
