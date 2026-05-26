export interface IFileSystem {
  /** Directory the platform considers writable for app-private data. */
  readonly appDataDir: string;

  exists(path: string): Promise<boolean>;
  makeDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  size(path: string): Promise<number>;
}
