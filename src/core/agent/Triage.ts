import type { AgentProfile } from '@core/agent/AgentProfile';
import { buildTriagePrompt } from '@core/agent/PromptBuilder';
import { completeJson, type StructuredLlmDeps } from '@core/llm/StructuredLlm';

export interface TriageResult {
  readonly relevant: boolean;
  readonly score: number;
  readonly reason: string;
}

/** Cheap binary gate: should the agent even consider acting on this candidate? */
export async function assessRelevance(
  deps: StructuredLlmDeps,
  profile: AgentProfile,
  candidateText: string,
): Promise<TriageResult | null> {
  return completeJson<TriageResult>(
    deps,
    buildTriagePrompt(profile, candidateText),
    validateTriage,
  );
}

function validateTriage(value: unknown): TriageResult | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.relevant !== 'boolean') {
    return null;
  }
  const score = typeof v.score === 'number' && Number.isFinite(v.score) ? clamp01(v.score) : 0;
  const reason = typeof v.reason === 'string' ? v.reason.slice(0, 140) : '';
  return { relevant: v.relevant, score, reason };
}

function clamp01(n: number): number {
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}
