/**
 * Desktop-only tunables. Mirrors the role of `StorageConfig`/`NetworkConfig`
 * but for the desktop (Node/Electron) target only. Per project rules, no
 * call site is allowed to hardcode these — they all flow through here.
 */
export const DesktopConfig = {
  /**
   * Folder name under the OS-specific user data root (e.g.
   * `%APPDATA%/Resonance` on Windows). The concrete absolute path is
   * resolved at runtime by `NodeFileSystem` from `os.homedir()` or, in
   * Electron, from `app.getPath('userData')`.
   */
  appFolderName: 'Resonance',

  /** Filename used by `NodeKvStore` for the JSON-on-disk key/value store. */
  kvStoreFile: 'kv-store.json',

  /**
   * Filename used by `NodeSqliteDatabase`. Distinct from
   * `StorageConfig.databaseFile` because expo-sqlite manages its own
   * directory; on desktop we keep the DB inside the app data dir.
   */
  databaseFile: 'resonance.db',

  /**
   * Relative path (from the repo root in dev, from the unpacked Electron
   * resource dir in prod) to the Bare entry file hosting the P2P worker
   * on desktop. Bare resolves its `import`s out of `node_modules` at
   * runtime — bundling is reserved for production packaging where a
   * single self-contained file is preferred (see `bare/build-desktop.mjs`).
   */
  bareDesktopEntry: 'bare/p2p.desktop-entry.mjs',

  /**
   * Bare binary name shipped by the `bare-runtime` package. Resolution
   * happens at runtime via `require.resolve('bare-runtime/package.json')`
   * + the platform-specific binary path.
   */
  bareBinaryEnvVar: 'RESONANCE_BARE_BIN',

  /**
   * Channel used to forward log lines from the Bare subprocess so they
   * don't collide with the framed RPC binary stream on stdout.
   */
  bareLogPrefix: '[bare]',
} as const;
