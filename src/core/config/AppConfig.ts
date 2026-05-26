import { MatchingConfig } from './MatchingConfig';
import { ModelProfiles } from './ModelProfiles';
import { NetworkConfig } from './NetworkConfig';
import { StorageConfig } from './StorageConfig';

/**
 * Single read-only view over all config. Use cases and adapters depend on
 * `AppConfig`, not on the individual modules — so swapping a config source
 * later (env vars, remote attestation, etc.) touches only this file.
 */
export const AppConfig = {
  matching: MatchingConfig,
  models: ModelProfiles,
  network: NetworkConfig,
  storage: StorageConfig,
} as const;

export type AppConfigShape = typeof AppConfig;
