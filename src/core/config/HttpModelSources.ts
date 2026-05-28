/**
 * Hosted model artefacts. URLs are constructed by `hfResolve` so the repo,
 * commit and filename are visible in one place. These are the exact same
 * URLs JarvisDocs uses successfully — keep them in sync.
 */

const HF_BASE = 'https://huggingface.co';

function hfResolve(repo: string, commit: string, path: string): string {
  return `${HF_BASE}/${repo}/resolve/${commit}/${path}`;
}

// ─── bge-m3 Q8_0 (ggml-org/bge-m3-Q8_0-GGUF) ────────────────────────────────
// Multilingual contrastive embedding model. 1024-dim dense vectors, no
// instruction prefix required, no Matryoshka representation learning (so we
// keep the full 1024-dim — see MatchingConfig.embeddingDim).
const BGE_M3_REPO = 'ggml-org/bge-m3-Q8_0-GGUF';
const BGE_M3_COMMIT = 'main';

// ─── Qwen3 1.7B (unsloth/Qwen3-1.7B-GGUF) ───────────────────────────────────
const QWEN3_REPO = 'unsloth/Qwen3-1.7B-GGUF';
const QWEN3_COMMIT = 'd7f544eead698dbd1f15126ef60b45a1e1933222';

export const HttpModelSources = {
  bgeM3Q8: {
    url: hfResolve(BGE_M3_REPO, BGE_M3_COMMIT, 'bge-m3-q8_0.gguf'),
    sha256: 'TODO_FILL_SHA256_AT_FIRST_DOWNLOAD',
    sizeBytes: 635 * 1024 * 1024,
  },
  qwen3_1_7bQ4_0: {
    url: hfResolve(QWEN3_REPO, QWEN3_COMMIT, 'Qwen3-1.7B-Q4_0.gguf'),
    sha256: 'TODO_FILL_SHA256_AT_FIRST_DOWNLOAD',
    sizeBytes: 1_100 * 1024 * 1024,
  },
} as const;
