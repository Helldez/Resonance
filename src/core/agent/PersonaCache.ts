import type { AgentProfile } from '@core/agent/AgentProfile';

/** FNV-1a 32-bit hash of a string, hex. No deps, no regex. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable KV-cache key for the agent persona. The basis is ONLY the fields that
 * appear in `buildPersonaPrefix` (name, interests, goals, tone) — the bytes that
 * make up the cached `system` message. Limits, thresholds and autonomy are
 * excluded, so tuning them does not invalidate the cached persona prefix.
 */
export function personaCacheKey(profile: AgentProfile): string {
  const basis = JSON.stringify({
    name: profile.name,
    interests: profile.interests,
    goals: profile.goals,
    tone: profile.tone,
  });
  return `persona-${fnv1a(basis)}`;
}
