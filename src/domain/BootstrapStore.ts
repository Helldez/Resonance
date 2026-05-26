import { create } from 'zustand';
import type { BootstrapState } from './types';

interface BootstrapStore extends BootstrapState {
  setStage: (stage: BootstrapState['stage']) => void;
  setProgress: (read: number, total: number) => void;
  setError: (message: string) => void;
  setSelf: (self: NonNullable<BootstrapState['self']>) => void;
}

export const useBootstrapStore = create<BootstrapStore>((set) => ({
  stage: 'idle',
  setStage: (stage) => set({ stage }),
  setProgress: (progressBytes, totalBytes) => set({ progressBytes, totalBytes }),
  setError: (error) => set({ stage: 'error', error }),
  setSelf: (self) => set({ self }),
}));
