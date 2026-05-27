import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { StorageConfig } from '@core/config/StorageConfig';
import type { SettingsState, ResponseMode } from './types';

interface SettingsStore extends SettingsState {
  setResponseMode: (mode: ResponseMode) => void;
  setReceiverContext: (text: string) => void;
  setSimilarityThreshold: (value: number) => void;
  setDisplayName: (value: string) => void;
}

/**
 * SettingsStore — persisted to AsyncStorage so the user's choices survive
 * an app restart. The key is namespaced by `StorageConfig.settingsKvKey`.
 *
 * Defaults come from `MatchingConfig`, never inlined here.
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      responseMode: 'draft-confirm',
      receiverContext: '',
      similarityThreshold: MatchingConfig.defaultInboxSimilarityThreshold,
      displayName: '',
      setResponseMode: (responseMode) => set({ responseMode }),
      setReceiverContext: (receiverContext) => set({ receiverContext }),
      setSimilarityThreshold: (similarityThreshold) => set({ similarityThreshold }),
      setDisplayName: (displayName) => set({ displayName }),
    }),
    {
      name: StorageConfig.settingsKvKey,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        responseMode: state.responseMode,
        receiverContext: state.receiverContext,
        similarityThreshold: state.similarityThreshold,
        displayName: state.displayName,
      }),
    },
  ),
);
