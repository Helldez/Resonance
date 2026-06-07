/**
 * Barrel for the agent loop. The implementation is split by responsibility:
 *   - AgentLoopTypes.ts    — deps, sinks, candidate/report shapes
 *   - EngagementBand.ts    — similarity → respond/react/skip
 *   - ProcessCandidate.ts  — decide → govern → act for one candidate
 *   - AgentTick.ts         — runAgentTick / runAgentPost orchestration
 * Existing importers (UI, tests) keep using `@core/agent/AgentLoop`.
 */
export type { ActivityKind, AgentLogPhase } from '@core/agent/ActivityTypes';
export type {
  AgentCandidate,
  AgentPendingItem,
  ActivityCounters,
  PendingSink,
  AgentLogSink,
  AgentLoopDeps,
  TickReport,
  CandidateOutcome,
} from '@core/agent/AgentLoopTypes';
export { NOOP_LOG } from '@core/agent/AgentLoopTypes';
export { engagementBand } from '@core/agent/EngagementBand';
export { processCandidate, executeProposed, toPending } from '@core/agent/ProcessCandidate';
export { runAgentTick, runAgentPost } from '@core/agent/AgentTick';
