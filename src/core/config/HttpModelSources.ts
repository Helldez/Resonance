/**
 * Hosted model artefacts. URLs are constructed by `hfResolve` so the repo,
 * commit and filename are visible in one place. These are the exact same
 * URLs JarvisDocs uses successfully — keep them in sync.
 */

const HF_BASE = 'https://huggingface.co';

function hfResolve(repo: string, commit: string, path: string): string {
  return `${HF_BASE}/${repo}/resolve/${commit}/${path}`;
}

// ─── EmbeddingGemma 300M (ggml-org/embeddinggemma-300M-GGUF) ────────────────
const EMBEDDING_GEMMA_REPO = 'ggml-org/embeddinggemma-300M-GGUF';
const EMBEDDING_GEMMA_COMMIT = 'main';

// ─── Qwen3 1.7B (unsloth/Qwen3-1.7B-GGUF) ───────────────────────────────────
const QWEN3_REPO = 'unsloth/Qwen3-1.7B-GGUF';
const QWEN3_COMMIT = 'd7f544eead698dbd1f15126ef60b45a1e1933222';

export const HttpModelSources = {
  embeddingGemma300mQ8: {
    url: hfResolve(EMBEDDING_GEMMA_REPO, EMBEDDING_GEMMA_COMMIT, 'embeddinggemma-300M-Q8_0.gguf'),
    sha256: 'TODO_FILL_SHA256_AT_FIRST_DOWNLOAD',
    sizeBytes: 320 * 1024 * 1024,
  },
  qwen3_1_7bQ4_0: {
    url: hfResolve(QWEN3_REPO, QWEN3_COMMIT, 'Qwen3-1.7B-Q4_0.gguf'),
    sha256: 'TODO_FILL_SHA256_AT_FIRST_DOWNLOAD',
    sizeBytes: 1_100 * 1024 * 1024,
  },
} as const;
