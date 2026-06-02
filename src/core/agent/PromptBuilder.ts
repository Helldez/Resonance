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
    'Prefer concrete contributions — a specific detail, fact, example, or clear',
    'opinion — over questions. Only ever react to content actually present in the',
    'room. Never invent facts, people, links, or events. Keep everything short.',
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
  _profile: AgentProfile,
  candidateText: string,
  threadContext: string | null,
): string {
  const parts = [
    '--- ITEM YOU ARE REPLYING TO ---',
    candidateText.trim(),
    '--- END ---',
  ];
  const inThread = threadContext !== null && threadContext.trim().length > 0;
  if (inThread) {
    parts.push('', 'Recent conversation in this thread (oldest first):', threadContext.trim());
  }
  parts.push(
    '',
    'Write ONE short reply. Contribute something concrete — a specific detail,',
    'fact, example, or clear opinion. A question is optional; ask one only if it',
    'genuinely moves the conversation forward. No greetings, no sign-off, no praise.',
  );
  if (inThread) {
    parts.push(
      'Add ONE genuinely NEW point. Do NOT restate, agree with, or reword anything',
      'already said in the thread above.',
    );
  }
  parts.push('Set "text" to the reply and "rationale" to a one-line why.');
  return parts.join('\n');
}

/** New-post authoring: write one short post advancing a specific goal. */
export function buildPostPrompt(_profile: AgentProfile, goal: string): string {
  return [
    `Write ONE short post (1-3 sentences) that advances this goal: "${goal}".`,
    'Make a concrete statement or share a specific idea that stands on its own.',
    'You may invite a response, but the post must not be only a question.',
    'No hashtags, no emoji. Set "text" to the post.',
  ].join('\n');
}
