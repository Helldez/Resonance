/**
 * Paths and filenames used by the storage layer. All paths are relative to
 * the platform's app-data dir, which is provided by `IFileSystem.appDataDir`
 * at runtime. We never assume a concrete absolute path here.
 */
export const StorageConfig = {
  /** Subdirectory under appDataDir for downloaded GGUF model files. */
  modelsDir: 'models',

  /** Subdirectory holding the Hypercore corestore. */
  corestoreDir: 'corestore',

  /** SQLite database file (under expo-sqlite's managed location). */
  databaseFile: 'resonance.db',

  /**
   * AsyncStorage key for the identity keypair. Note: AsyncStorage on
   * Android is NOT encrypted at rest — it lives in the app's sandboxed
   * data dir. Phase 2 will migrate this to `expo-secure-store` for
   * Android Keystore-backed encryption. Until then we mitigate by
   * setting `android:allowBackup="false"` in `app.json`, which prevents
   * the keypair from being exfiltrated through Google Cloud Backup. See
   * `SECURITY.md`.
   */
  identityKvKey: 'resonance/identity/ed25519',

  /** AsyncStorage key for app-level settings (user prefs). */
  settingsKvKey: 'resonance/settings/v1',
} as const;
