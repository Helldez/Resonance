import * as ExpoFs from 'expo-file-system';
import type {
  IModelRegistry,
  ModelDescriptor,
  ModelDownloadProgress,
} from '@core/ports/IModelRegistry';
import type { IFileSystem } from '@core/ports/IFileSystem';
import { StorageConfig } from '@core/config/StorageConfig';

/**
 * Resolve, download (with resume), and checksum-verify GGUF model files
 * under the platform's app-data dir. Verification is intentionally on a
 * separate adapter — see `Sha256Verifier` (M1).
 */
export class ExpoModelRegistry implements IModelRegistry {
  constructor(
    private readonly fs: IFileSystem,
    private readonly verifyChecksum: (path: string, expected: string) => Promise<boolean>,
  ) {}

  resolveLocalPath(model: ModelDescriptor): string {
    return joinPath(this.modelsRoot(), `${model.id}.gguf`);
  }

  async isAvailable(model: ModelDescriptor): Promise<boolean> {
    const path = this.resolveLocalPath(model);
    if (!(await this.fs.exists(path))) {
      return false;
    }
    return this.verifyChecksum(path, model.sha256);
  }

  async ensureAvailable(
    model: ModelDescriptor,
    onProgress?: (p: ModelDownloadProgress) => void,
  ): Promise<string> {
    await this.fs.makeDir(this.modelsRoot());
    const path = this.resolveLocalPath(model);

    if (await this.isAvailable(model)) {
      return path;
    }

    const resumable = ExpoFs.createDownloadResumable(
      model.url,
      path,
      {},
      (progress) =>
        onProgress?.({
          bytesRead: progress.totalBytesWritten,
          totalBytes: progress.totalBytesExpectedToWrite,
        }),
    );

    const result = await resumable.downloadAsync();
    if (result === undefined) {
      throw new Error(`ExpoModelRegistry: download produced no result for ${model.id}`);
    }

    if (!(await this.verifyChecksum(result.uri, model.sha256))) {
      await this.fs.remove(result.uri);
      throw new Error(
        `ExpoModelRegistry: checksum mismatch for ${model.id}; deleted partial file`,
      );
    }
    return result.uri;
  }

  async remove(model: ModelDescriptor): Promise<void> {
    await this.fs.remove(this.resolveLocalPath(model));
  }

  private modelsRoot(): string {
    return joinPath(this.fs.appDataDir, StorageConfig.modelsDir);
  }
}

function joinPath(a: string, b: string): string {
  if (a.endsWith('/')) {
    return `${a}${b}`;
  }
  return `${a}/${b}`;
}
