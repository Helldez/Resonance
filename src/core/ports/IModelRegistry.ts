export type ModelKind = 'embedding' | 'llm';

export interface ModelDescriptor {
  readonly id: string;
  readonly kind: ModelKind;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Native embedding dim, only meaningful for `kind: 'embedding'`. */
  readonly nativeDim?: number;
}

export interface ModelDownloadProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
}

export interface IModelRegistry {
  /** Local absolute path where a model would live (whether present or not). */
  resolveLocalPath(model: ModelDescriptor): string;

  /** Whether the model is already downloaded and checksum-valid. */
  isAvailable(model: ModelDescriptor): Promise<boolean>;

  /**
   * Download the model if not present, verify checksum, resume on partial
   * downloads. Calls `onProgress` periodically. Returns the local path.
   */
  ensureAvailable(
    model: ModelDescriptor,
    onProgress?: (p: ModelDownloadProgress) => void,
  ): Promise<string>;

  /** Remove a model from disk. */
  remove(model: ModelDescriptor): Promise<void>;
}
