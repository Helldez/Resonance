import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { StorageConfig } from '@core/config/StorageConfig';
import type { ModelKind } from '@core/config/ModelProfiles';

interface ModelInstallState {
  readonly embeddingInstalled: boolean;
  readonly llmInstalled: boolean;
}

interface ModelInstallStore extends ModelInstallState {
  markInstalled: (model: ModelKind) => void;
}

/**
 * Records which models have finished their first download, persisted to
 * AsyncStorage. The boot splash reads this to show byte progress only for a
 * real first download — a later launch loads the cached file into memory, which
 * is not a download and should not display MB. The QVAC SDK owns the model
 * cache, so a deterministic flag is more reliable than probing the filesystem.
 */
export const useModelInstallStore = create<ModelInstallStore>()(
  persist(
    (set) => ({
      embeddingInstalled: false,
      llmInstalled: false,
      markInstalled: (model) =>
        set(model === 'embedding' ? { embeddingInstalled: true } : { llmInstalled: true }),
    }),
    {
      name: StorageConfig.modelInstallKvKey,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        embeddingInstalled: state.embeddingInstalled,
        llmInstalled: state.llmInstalled,
      }),
    },
  ),
);
