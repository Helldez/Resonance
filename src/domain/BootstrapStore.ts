import { create } from 'zustand';
import type { BootstrapState } from './types';

type BootstrapStore = BootstrapState & {
  setStage: (stage: BootstrapState['stage']) => void;
  setProgress: (read: number, total: number) => void;
  setError: (message: string) => void;
  setSelf: (self: NonNullable<BootstrapState['self']>) => void;
};

export const useBootstrapStore = create<BootstrapStore>((set) => ({
  stage: 'idle',
  // Entering a new stage invalidates any previous stage's byte progress —
  // without the reset, the Splash rendered the finished embedding-model
  // download bar under the next step's label ("Connecting to the network").
  setStage: (stage) => set({ stage, progressBytes: undefined, totalBytes: undefined }),
  setProgress: (progressBytes, totalBytes) => set({ progressBytes, totalBytes }),
  setError: (error) => set({ stage: 'error', error }),
  setSelf: (self) => set({ self }),
}));
