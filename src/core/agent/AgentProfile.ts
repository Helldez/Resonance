import { AgentConfig } from '@core/config/AgentConfig';

/**
 * Autonomy is the single dial that shapes the whole agent UX:
 *   - off       — the agent never acts.
 *   - suggest   — the agent prepares drafts into an approval queue; nothing is
 *                 ever published without the user's tap.
 *   - autopilot — the agent acts on its own, strictly within `limits`.
 */
export type Autonomy = 'off' | 'suggest' | 'autopilot';

export interface AgentLimits {
  readonly maxPostsPerDay: number;
  readonly maxCommentsPerDay: number;
  readonly maxReactionsPerDay: number;
  readonly maxTurnsPerThread: number;
  /** Phrases the agent must never emit (deterministic guard, lowercased match). */
  readonly never: ReadonlyArray<string>;
}

/**
 * The user-authored persona. This is the source of truth, edited through a
 * native form (never a markdown file) and persisted via the settings store.
 * The system prompt is *generated* from these fields by `PromptBuilder`; the
 * `limits` feed the deterministic `ActionGovernor`, not the model.
 */
export interface AgentProfile {
  readonly enabled: boolean;
  readonly name: string;
  readonly autonomy: Autonomy;
  readonly interests: ReadonlyArray<string>;
  readonly goals: ReadonlyArray<string>;
  readonly tone: string;
  readonly limits: AgentLimits;
}

export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  enabled: false,
  name: AgentConfig.defaults.name,
  autonomy: 'suggest',
  interests: [],
  goals: [],
  tone: AgentConfig.defaults.tone,
  limits: {
    maxPostsPerDay: AgentConfig.defaults.limits.maxPostsPerDay,
    maxCommentsPerDay: AgentConfig.defaults.limits.maxCommentsPerDay,
    maxReactionsPerDay: AgentConfig.defaults.limits.maxReactionsPerDay,
    maxTurnsPerThread: AgentConfig.defaults.limits.maxTurnsPerThread,
    never: AgentConfig.defaults.limits.never,
  },
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  const v = Math.round(value);
  if (v < min) {
    return min;
  }
  if (v > max) {
    return max;
  }
  return v;
}

/**
 * Coerce an arbitrary (possibly persisted-from-older-version) object into a
 * valid `AgentProfile`, clamping every number to `AgentConfig.caps` and
 * trimming list lengths. Pure — safe to call on load and on every form edit.
 */
export function normalizeProfile(input: Partial<AgentProfile> | null | undefined): AgentProfile {
  const base = input ?? {};
  const limits = base.limits ?? DEFAULT_AGENT_PROFILE.limits;
  return {
    enabled: base.enabled ?? DEFAULT_AGENT_PROFILE.enabled,
    name: (base.name ?? DEFAULT_AGENT_PROFILE.name).trim() || DEFAULT_AGENT_PROFILE.name,
    autonomy: normalizeAutonomy(base.autonomy),
    interests: (base.interests ?? []).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, AgentConfig.caps.maxInterests),
    goals: (base.goals ?? []).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, AgentConfig.caps.maxGoals),
    tone: (base.tone ?? DEFAULT_AGENT_PROFILE.tone).trim() || DEFAULT_AGENT_PROFILE.tone,
    limits: {
      maxPostsPerDay: clampInt(limits.maxPostsPerDay, 0, AgentConfig.caps.maxPostsPerDay),
      maxCommentsPerDay: clampInt(limits.maxCommentsPerDay, 0, AgentConfig.caps.maxCommentsPerDay),
      maxReactionsPerDay: clampInt(limits.maxReactionsPerDay, 0, AgentConfig.caps.maxReactionsPerDay),
      maxTurnsPerThread: clampInt(limits.maxTurnsPerThread, 1, AgentConfig.caps.maxTurnsPerThread),
      never: (limits.never ?? []).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
    },
  };
}

function normalizeAutonomy(value: Autonomy | undefined): Autonomy {
  if (value === 'off' || value === 'suggest' || value === 'autopilot') {
    return value;
  }
  return DEFAULT_AGENT_PROFILE.autonomy;
}
