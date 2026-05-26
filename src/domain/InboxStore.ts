import { create } from 'zustand';
import type { ScoredPost } from '@core/domain/types';
import type { InboxState } from './types';

interface InboxStore extends InboxState {
  add: (item: ScoredPost) => void;
  clear: () => void;
}

export const useInboxStore = create<InboxStore>((set, get) => ({
  items: [],
  add: (item) => {
    const next = [item, ...get().items.filter((i) => i.address !== item.address)];
    set({ items: next });
  },
  clear: () => set({ items: [] }),
}));
