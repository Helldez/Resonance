import * as ExpoFs from 'expo-file-system';
import type { IFileSystem } from '@core/ports/IFileSystem';

export class ExpoFileSystem implements IFileSystem {
  readonly appDataDir: string = ExpoFs.documentDirectory ?? '';

  async exists(path: string): Promise<boolean> {
    const info = await ExpoFs.getInfoAsync(path);
    return info.exists;
  }

  async makeDir(path: string): Promise<void> {
    await ExpoFs.makeDirectoryAsync(path, { intermediates: true });
  }

  async remove(path: string): Promise<void> {
    await ExpoFs.deleteAsync(path, { idempotent: true });
  }

  async size(path: string): Promise<number> {
    const info = await ExpoFs.getInfoAsync(path, { size: true });
    if (!info.exists) {
      return 0;
    }
    const size = (info as { size?: number }).size;
    return size ?? 0;
  }
}
