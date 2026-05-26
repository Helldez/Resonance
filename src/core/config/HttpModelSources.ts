/**
 * Hosted model artefacts. URLs and checksums must be updated together — a
 * checksum mismatch aborts the download. We never trust the URL alone.
 *
 * If you change a model entry, recompute the SHA-256 of the GGUF file with
 * `Get-FileHash file.gguf -Algorithm SHA256` (PowerShell) and update both
 * fields in the same commit.
 */
export const HttpModelSources = {
  embeddingGemma300mQ5: {
    url: 'https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q5_K_M.gguf',
    sha256: 'TODO_FILL_SHA256_AT_FIRST_DOWNLOAD',
    sizeBytes: 280 * 1024 * 1024,
  },
  qwen3_4bInstructQ4: {
    url: 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-GGUF/resolve/main/Qwen3-4B-Instruct-Q4_K_M.gguf',
    sha256: 'TODO_FILL_SHA256_AT_FIRST_DOWNLOAD',
    sizeBytes: 2_500 * 1024 * 1024,
  },
} as const;
