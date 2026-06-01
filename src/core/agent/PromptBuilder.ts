import type { AgentProfile } from '@core/agent/AgentProfile';

/**
 * Builds the agent's prompts from the structured `AgentProfile`. The user never
 * writes a raw prompt — these deterministic templates do. The persona prefix is
 * stable across a tick so it can be reused from the LLM's kv-cache; only the
 * candidate-specific tail changes.
 */

/** Stable persona block — the kv-cacheable prefix shared by every call. */
export function buildPersonaPrefix(profile: AgentProfile): string {
  const interests =
    profile.interests.length > 0 ? profile.interests.join(', ') : '(none stated)';
  const goals =
    profile.goals.length > 0
      ? profile.goals.map((g, i) => `  ${i + 1}. ${g}`).join('\n')
      : '  (none stated)';
  return [
    `You act in a peer-to-peer room on behalf of a user. Your name is "${profile.name}".`,
    `The user's interests: ${interests}.`,
    'The user\'s goals:',
    goals,
    `Write in this tone: ${profile.tone}.`,
    'Only ever react to content actually present in the room. Never invent facts,',
    'people, links, or events. Keep everything short. When in doubt, do nothing.',
  ].join('\n');
}

/**
 * Engagement band, derived deterministically from the candidate's similarity
 * (see `AgentConfig.engagement`): `respond` → the agent comments, `react` → it
 * acknowledges with a like. The band is the decision; the LLM never overrides it.
 */
export type EngagementBand = 'respond' | 'react';

/**
 * Reply drafting. The decision to reply was already made deterministically from
 * the candidate's similarity (see `AgentConfig.engagement`); the LLM's only job
 * here is to write the text. There is no "should I?" — only "what would I say?".
 */
export function buildReplyPrompt(
  profile: AgentProfile,
  candidateText: string,
  threadContext: string | null,
): string {
  const parts = [
    buildPersonaPrefix(profile),
    '',
    '--- ITEM YOU ARE REPLYING TO ---',
    candidateText.trim(),
    '--- END ---',
  ];
  if (threadContext !== null && threadContext.trim().length > 0) {
    parts.push('', 'Recent conversation in this thread (oldest first):', threadContext.trim());
  }
  parts.push(
    '',
    'Write ONE short reply (1 sentence) that adds something specific or asks one',
    'sharp question. No greetings, no sign-off, no generic praise.',
    'Reply with ONLY a JSON object of the form:',
    '{"text": "<=240 chars", "rationale": "<=120 chars"}',
  );
  return parts.join('\n');
}

/** New-post authoring: write one short post advancing a specific goal. */
export function buildPostPrompt(profile: AgentProfile, goal: string): string {
  return [
    buildPersonaPrefix(profile),
    '',
    `Write ONE short post (1-3 sentences) that advances this goal: "${goal}".`,
    'It must stand on its own, invite a relevant stranger to respond, and contain no hashtags or emoji.',
    'Reply with ONLY a JSON object of the form:',
    '{"text": "<=280 chars"}',
  ].join('\n');
}
