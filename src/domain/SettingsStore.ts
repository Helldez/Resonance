import { create } from 'zustand';
import { MatchingConfig } from '@core/config/MatchingConfig';
import type { SettingsState, ResponseMode } from './types';

interface SettingsStore extends SettingsState {
  setResponseMode: (mode: ResponseMode) => void;
  setReceiverContext: (text: string) => void;
  setSimilarityThreshold: (value: number) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  responseMode: 'draft-confirm',
  receiverContext: '',
  similarityThreshold: MatchingConfig.defaultInboxSimilarityThreshold,
  setResponseMode: (responseMode) => set({ responseMode }),
  setReceiverContext: (receiverContext) => set({ receiverContext }),
  setSimilarityThreshold: (similarityThreshold) => set({ similarityThreshold }),
}));
