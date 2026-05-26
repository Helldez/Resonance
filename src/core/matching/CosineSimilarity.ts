/**
 * Cosine similarity between two equally-dimensioned vectors, computed as a
 * plain dot product. Correct only if both vectors are L2-normalised — which
 * is the project-wide convention (see AGENTS.md, "Matching conventions").
 *
 * Throws on length mismatch because routing the wrong dimensions through
 * here would silently degrade matching.
 */
export function cosineOnUnit(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineOnUnit: dimension mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
