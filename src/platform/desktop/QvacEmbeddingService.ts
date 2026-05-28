/**
 * The QVAC embedding service depends only on `@qvac/sdk`, which
 * encapsulates all worker spawning and IPC. As long as `@qvac/sdk` works
 * under Node/Electron (it ships its Bare worker via the same runtime we
 * use for `DesktopP2pWorker`), the mobile adapter is reusable verbatim.
 */
export { QvacEmbeddingService } from '../mobile/QvacEmbeddingService';
export type { EmbeddingProgressCallback } from '../mobile/QvacEmbeddingService';
