/**
 * Hosted model artefacts. URLs are constructed by `hfResolve` so the repo,
 * commit and filename are visible in one place. These are the exact same
 * URLs JarvisDocs uses successfully — keep them in sync.
 */

const HF_BASE = 'https://huggingface.co';

function hfResolve(repo: string, commit: string, path: string): string {
  return `${HF_BASE}/${repo}/resolve/${commit}/${path}`;
}

// ─── EmbeddingGemma 300M Q8_0 (ggml-org/embeddinggemma-300M-GGUF) ────────────
// 768-dim dense embedding model. The single-room model (conf 9) feeds it the
// "clustering" prompt template (see ModelProfiles.embedding.promptTemplate)
// and keeps the full 768-dim — see MatchingConfig.embeddingDim.
//
// NOTE: Qwen3-Embedding-0.6B (1024-dim, decoder-only) was evaluated as a
// replacement. It needs `modelConfig: { pooling: 'last', attention: 'causal' }`
// and works on the desktop QVAC build, but on Android the Adreno GPU path of
// `embed-llamacpp` 0.16.0 segfaults loading the qwen3 arch. Forcing
// `device: 'cpu'` loads it on Android too, but at ~7.6 s/embed (vs ~78 ms for
// gemma on the GPU) with heavy memory pressure — too slow for the inbox.
// See memory `reference-qwen3-embedding-android-gpu`. Revisit if QVAC fixes
// the Adreno decoder-embedding path.
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
