import { Directory, File, Paths } from 'expo-file-system';
import type { IFileSystem } from '@core/ports/IFileSystem';

/**
 * expo-file-system v19 uses an object-oriented API (Paths/File/Directory)
 * rather than free functions. We expose only the small surface the core
 * needs.
 */
export class ExpoFileSystem implements IFileSystem {
  readonly appDataDir: string = Paths.document.uri;

  async exists(path: string): Promise<boolean> {
    return new File(path).exists;
  }

  async makeDir(path: string): Promise<void> {
    const dir = new Directory(path);
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  }

  async remove(path: string): Promise<void> {
    const file = new File(path);
    if (file.exists) {
      file.delete();
      return;
    }
    const dir = new Directory(path);
    if (dir.exists) {
      dir.delete();
    }
  }

  async size(path: string): Promise<number> {
    const file = new File(path);
    if (!file.exists) {
      return 0;
    }
    return file.size ?? 0;
  }
}
