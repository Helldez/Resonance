/**
 * Canonical agent-activity vocabulary, owned by the core. The data layer's
 * repositories (`AgentActivityRepository`, `AgentLogRepository`) import these
 * (data → core is the allowed direction); the core never imports from `@data`.
 */

/** What the daily caps count. Mirrors the governor's cap categories. */
export type ActivityKind = 'post' | 'comment' | 'reaction';

/**
 * Phase of a structured activity event, persisted by `AgentLogRepository` and
 * rendered in the in-app Activity dashboard.
 */
export type AgentLogPhase =
  | 'tick'        // a wake-up: how many candidates, autonomy
  | 'triage'      // relevance judgement on a candidate
  | 'decide'      // chosen action (respond/react/do_nothing)
  | 'govern'      // governor verdict (allow/queue/reject + reason)
  | 'publish'     // an action actually published to the room
  | 'queue'       // an action queued for approval (suggest mode)
  | 'post'        // a proactive post attempt
  | 'error';      // a tick-level failure
