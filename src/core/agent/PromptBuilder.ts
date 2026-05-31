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

/** Triage: is this candidate worth acting on at all? Cheap binary gate. */
export function buildTriagePrompt(profile: AgentProfile, candidateText: string): string {
  return [
    buildPersonaPrefix(profile),
    '',
    '--- CANDIDATE POST ---',
    candidateText.trim(),
    '--- END ---',
    '',
    'Decide whether engaging with this post would advance the user\'s goals.',
    'Reply with ONLY a JSON object of the form:',
    '{"relevant": true|false, "score": 0.0-1.0, "reason": "<=120 chars"}',
  ].join('\n');
}

/** Decision: pick exactly one action for a candidate that passed triage. */
export function buildDecisionPrompt(
  profile: AgentProfile,
  candidateText: string,
  threadContext: string | null,
): string {
  const parts = [
    buildPersonaPrefix(profile),
    '',
    '--- ITEM YOU ARE CONSIDERING ---',
    candidateText.trim(),
    '--- END ---',
  ];
  if (threadContext !== null && threadContext.trim().length > 0) {
    parts.push('', 'Recent conversation in this thread (oldest first):', threadContext.trim());
  }
  parts.push(
    '',
    'Choose exactly ONE action:',
    '- "respond": add a short, specific comment or reply (1 sentence). Set "text".',
    '- "react": acknowledge with a reaction. Set "reaction" to one of like|insightful|agree|curious.',
    '- "do_nothing": if you have nothing genuinely useful to add.',
    'Prefer one sharp question or a concrete contribution over generic praise.',
    'Reply with ONLY a JSON object of the form:',
    '{"action": "respond"|"react"|"do_nothing", "text": "<=240 chars", "reaction": "like|insightful|agree|curious", "rationale": "<=120 chars"}',
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
