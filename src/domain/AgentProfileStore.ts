import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  DEFAULT_AGENT_PROFILE,
  coerceProfile,
  normalizeProfile,
  type AgentProfile,
} from '@core/agent/AgentProfile';

interface AgentProfileStore {
  readonly profile: AgentProfile;
  /** Global kill switch — when on, the governor rejects every action. */
  readonly killSwitch: boolean;
  setProfile: (patch: Partial<AgentProfile>) => void;
  setKillSwitch: (value: boolean) => void;
}

/**
 * Persisted store for the user's `AgentProfile` — the editing surface is the
 * native form, this is where it lives. Every write is normalised (clamped to
 * `AgentConfig.caps`) so the agent loop and governor always read a valid
 * profile. The `killSwitch` is intentionally NOT persisted: it is a panic
 * control that resets to off on restart.
 */
export const useAgentProfileStore = create<AgentProfileStore>()(
  persist(
    (set, get) => ({
      profile: DEFAULT_AGENT_PROFILE,
      killSwitch: false,
      // Live edits use the tolerant coercion so a field the user is clearing
      // (e.g. the name) is not snapped back to the default mid-keystroke. The
      // strong normalisation runs at load (merge) and again where the agent
      // loop reads the profile.
      setProfile: (patch) =>
        set({ profile: coerceProfile({ ...get().profile, ...patch }) }),
      setKillSwitch: (killSwitch) => set({ killSwitch }),
    }),
    {
      name: 'resonance.agentProfile.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ profile: state.profile }),
      merge: (persisted, current) => {
        const p = persisted as { profile?: Partial<AgentProfile> } | undefined;
        return {
          ...current,
          profile: normalizeProfile(p?.profile),
        };
      },
    },
  ),
);
