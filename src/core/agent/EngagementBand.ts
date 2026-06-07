import type { AgentThresholds } from '@core/agent/AgentProfile';
import type { EngagementBand } from '@core/agent/PromptBuilder';

/**
 * Map a candidate's similarity to how far the agent may engage. A post the
 * user is close to can earn a reply; a moderately related one only a reaction;
 * anything weaker (or unscored) is left alone. The thresholds are user-tunable
 * (`AgentProfile.thresholds`) and share the inbox/map similarity vocabulary.
 */
export function engagementBand(
  similarity: number | null,
  thresholds: AgentThresholds,
): EngagementBand | 'skip' {
  if (similarity === null) {
    return 'skip';
  }
  if (similarity >= thresholds.respondMinSimilarity) {
    return 'respond';
  }
  if (similarity >= thresholds.reactMinSimilarity) {
    return 'react';
  }
  return 'skip';
}
