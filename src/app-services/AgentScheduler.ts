import type { PlatformContainer } from '@platform/PlatformContainer';
import { AgentConfig } from '@core/config/AgentConfig';
import { normalizeProfile, type AgentProfile } from '@core/agent/AgentProfile';
import { runAgentTick, runAgentPost } from '@core/agent/AgentLoop';
import { buildAgentDeps } from './AgentDeps';

/** Live read of the agent profile + kill switch (e.g. a Zustand getState). */
export type AgentProfileReader = () => {
  readonly profile: AgentProfile;
  readonly killSwitch: boolean;
};

export interface AgentScheduler {
  /** Arm the timer loop; returns the dispose function. */
  start(): () => void;
}

/**
 * The autonomous agent loop's cadence and session policy. Once started, the
 * agent wakes on a slow timer: perceive the inbox, triage, let the LLM
 * propose, and run every proposal through the deterministic ActionGovernor
 * before anything is published. Profile reads go through `getProfile` on
 * every tick so changes apply without re-arming. Owns the autopilot session
 * circuit breaker and the background LLM load kick.
 */
export function createAgentScheduler(
  c: PlatformContainer,
  getProfile: AgentProfileReader,
): AgentScheduler {
  let cancelled = false;
  let running = false;
  let tick = 0;
  // Autopilot circuit breaker: actions published this session, and whether we
  // already announced the pause (so we log it once, not every tick).
  let sessionActions = 0;
  let pauseAnnounced = false;
  let lastAutonomy = '';

  const runOnce = async (): Promise<void> => {
    if (cancelled || running) {
      return;
    }
    const { profile, killSwitch } = getProfile();
    const norm = normalizeProfile(profile);
    // Toggling autonomy (e.g. off→autopilot) re-arms the session budget.
    if (norm.autonomy !== lastAutonomy) {
      lastAutonomy = norm.autonomy;
      sessionActions = 0;
      pauseAnnounced = false;
    }
    // Log the gate so logcat shows exactly why a tick is or isn't running.
    console.log(
      `[agent] gate llmLoaded=${c.llmConcrete.isLoaded} enabled=${norm.enabled} autonomy=${norm.autonomy} kill=${killSwitch} goals=${norm.goals.length} interests=${norm.interests.length}`,
    );
    if (!norm.enabled || norm.autonomy === 'off') {
      return;
    }
    if (!c.llmConcrete.isLoaded) {
      // The agent needs the LLM. Trigger a background load once so an enabled
      // agent becomes functional without the user having to visit Settings;
      // skip this tick and act on the next one after the model is ready.
      console.log('[agent] LLM not loaded yet — kicking off background load');
      void c.llmConcrete.load().catch((e) => {
        console.warn(`[agent] LLM load failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      return;
    }
    // Autopilot circuit breaker: once the session budget is spent, stop
    // publishing on autopilot (Suggest still queues — a human gates those).
    if (norm.autonomy === 'autopilot' && sessionActions >= AgentConfig.sessionActionBudget) {
      if (!pauseAnnounced) {
        pauseAnnounced = true;
        await c.agentLog.append(
          c.clock.now(),
          'tick',
          `Autopilot paused — reached ${AgentConfig.sessionActionBudget} actions this session. Toggle autonomy off→autopilot in My agent to resume.`,
        );
      }
      return;
    }
    running = true;
    try {
      const deps = buildAgentDeps(c, norm, killSwitch);
      const report = await runAgentTick(deps);
      tick++;
      sessionActions += report.published;
      console.log(
        `[rn] agent tick considered=${report.considered} published=${report.published} queued=${report.queued} rejected=${report.rejected} sessionActions=${sessionActions}`,
      );
      if (report.considered === 0) {
        await c.agentLog.append(
          c.clock.now(),
          'tick',
          'Woke up — nothing new in the inbox to consider',
        );
      }
      // Seed a post toward a goal on a steady cadence — decoupled from the
      // reactive output. Previously this only fired when the tick neither
      // published nor queued anything, so reactions/replies pre-empted it and
      // the agent almost never posted. Now it runs every 4th tick regardless;
      // the daily cap (maxPostsPerDay) and the session budget bound it, and
      // runAgentPost no-ops without a goal or once the cap is hit.
      if (tick % 4 === 1) {
        const posted = await runAgentPost(deps);
        if (posted) {
          sessionActions += 1;
        }
        console.log(`[agent] proactive post attempted=${posted}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[rn] agent tick failed: ${msg}`);
      try {
        await c.agentLog.append(c.clock.now(), 'error', `Tick failed: ${msg}`);
      } catch {
        // logging must never crash the loop
      }
    } finally {
      running = false;
    }
  };

  return {
    start(): () => void {
      cancelled = false;
      const interval = setInterval(() => {
        void runOnce();
      }, AgentConfig.tickIntervalMs);
      const kick = setTimeout(() => {
        void runOnce();
      }, AgentConfig.firstTickDelayMs);
      return () => {
        cancelled = true;
        clearInterval(interval);
        clearTimeout(kick);
      };
    },
  };
}
