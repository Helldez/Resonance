import { AgentConfig } from '@core/config/AgentConfig';
import { PostAction, type PostPayload } from '@core/agent/AgentActions';
import { buildPostPrompt, buildPersonaPrefix } from '@core/agent/PromptBuilder';
import { completeJson } from '@core/llm/StructuredLlm';
import { dayKey, isDuplicate } from '@core/agent/AgentMemory';
import {
  evaluateAction,
  type GovernorState,
  type ProposedAction,
} from '@core/agent/ActionGovernor';
import { engagementBand } from '@core/agent/EngagementBand';
import {
  executeProposed,
  processCandidate,
  toPending,
} from '@core/agent/ProcessCandidate';
import {
  NOOP_LOG,
  type AgentLoopDeps,
  type CandidateOutcome,
  type TickReport,
} from '@core/agent/AgentLoopTypes';

/**
 * One agent tick: perceive → triage → propose (LLM) → enforce (governor) → act
 * → remember. The LLM only proposes; `evaluateAction` is the sole gate that
 * authorises a write, and it reads its counters from SQLite, never the model.
 */
export async function runAgentTick(deps: AgentLoopDeps): Promise<TickReport> {
  const { profile } = deps;
  const sink = deps.logSink ?? NOOP_LOG;
  const empty: TickReport = { considered: 0, published: 0, queued: 0, rejected: 0 };
  if (!profile.enabled || profile.autonomy === 'off' || deps.killSwitch) {
    return empty;
  }

  const day = dayKey(deps.clock.now());

  // Pre-check the daily caps BEFORE spending any LLM tokens. In autopilot, if
  // every action class is exhausted there is nothing the agent could publish,
  // so thinking again this tick would just re-reject — the "ri-pensiero" loop.
  // (Suggest still drafts into the queue, so it is exempt.)
  if (profile.autonomy === 'autopilot') {
    const [p, c, r] = await Promise.all([
      deps.activity.countToday(day, 'post'),
      deps.activity.countToday(day, 'comment'),
      deps.activity.countToday(day, 'reaction'),
    ]);
    const canComment = c < profile.limits.maxCommentsPerDay;
    const canReact = r < profile.limits.maxReactionsPerDay;
    const canPost = p < profile.limits.maxPostsPerDay;
    if (!canComment && !canReact && !canPost) {
      await sink.log('govern', 'All daily caps reached — resting until tomorrow (not re-thinking)');
      return empty;
    }
  }

  const candidates = await deps.listCandidates(AgentConfig.maxCandidatesPerTick);
  const recent = await deps.activity.recentOutputs(AgentConfig.dedupHistorySize);
  console.log(`[agent] candidates=${candidates.length} recentDedup=${recent.length} autonomy=${profile.autonomy}`);
  await sink.log('tick', `Woke up · ${candidates.length} posts to consider · mode ${profile.autonomy}`);

  let published = 0;
  let queued = 0;
  let rejected = 0;

  const tally = (outcome: CandidateOutcome): void => {
    if (outcome === 'published') {
      published++;
    } else if (outcome === 'queued') {
      queued++;
    } else if (outcome === 'rejected') {
      rejected++;
    }
  };

  // First, reply to comments the user has received — under their own posts, or
  // in threads the agent already joined. These are conversations aimed at us,
  // so they are not gated by affinity: they run in the respond band and skip
  // triage. The query bounds them by the per-thread turn cap.
  const replies = await deps.listReplyCandidates(AgentConfig.maxReplyCandidatesPerTick);
  if (replies.length > 0) {
    console.log(`[agent] replyCandidates=${replies.length}`);
  }
  for (const cand of replies) {
    tally(await processCandidate(deps, sink, day, recent, cand, 'respond', true));
  }

  // Then fresh posts from peers, where the affinity band decides how far to go.
  for (const cand of candidates) {
    const short = cand.address.slice(0, 10);

    // Similarity decides how far the agent may engage, before any LLM tokens
    // are spent. A weak (or unscored) match is terminally skipped — the same
    // anti-loop discipline as a triage miss.
    const band = engagementBand(cand.similarity, profile.thresholds);
    const simStr = cand.similarity === null ? 'null' : cand.similarity.toFixed(2);
    console.log(`[agent] band ${short} -> ${band} (sim=${simStr})`);
    if (band === 'skip') {
      await deps.activity.markSkipped(cand.address, deps.clock.now());
      await sink.log(
        'triage',
        `Skipping — affinity ${simStr} below the reaction floor`,
        cand.address,
        null,
        cand.text,
      );
      continue;
    }

    tally(await processCandidate(deps, sink, day, recent, cand, band, false));
  }

  return {
    considered: candidates.length + replies.length,
    published,
    queued,
    rejected,
  };
}

/**
 * Author one proactive post advancing a goal. Separate from the reactive tick;
 * the caller decides when to invoke it (e.g. once when the inbox is quiet).
 * Goes through the governor exactly like any other action.
 */
export async function runAgentPost(deps: AgentLoopDeps): Promise<boolean> {
  const { profile } = deps;
  const sink = deps.logSink ?? NOOP_LOG;
  if (!profile.enabled || profile.autonomy === 'off' || deps.killSwitch) {
    return false;
  }
  if (profile.goals.length === 0) {
    await sink.log('post', 'Skipped a proactive post — no goals set. Add a goal in My agent.');
    return false;
  }
  const day = dayKey(deps.clock.now());
  // On autopilot, don't spend a draft LLM call the governor would only reject:
  // bail early once the daily post cap is reached. (Suggest still drafts into
  // the approval queue — a human gates those, so the cap is not pre-applied.)
  if (profile.autonomy === 'autopilot') {
    const postsToday = await deps.activity.countToday(day, 'post');
    if (postsToday >= profile.limits.maxPostsPerDay) {
      return false;
    }
  }
  const goal = profile.goals[0];
  const drafted = await completeJson<PostPayload>(
    { llm: deps.llm },
    buildPostPrompt(profile, goal),
    PostAction.validate,
    {
      temperature: PostAction.temperature,
      maxTokens: PostAction.maxTokens,
      responseSchema: PostAction.schema,
      system: buildPersonaPrefix(profile),
    },
  );
  console.log(
    `[agent] post drafted=${drafted === null ? 'NULL(parse-fail)' : `"${drafted.text.slice(0, 60)}"`} goal="${goal.slice(0, 40)}"`,
  );
  if (drafted === null) {
    await sink.log('post', 'Tried to write a post but the model output was unparseable');
    return false;
  }
  const recent = await deps.activity.recentOutputs(AgentConfig.dedupHistorySize);
  const proposed: ProposedAction = { kind: 'post', text: drafted.text };
  const state: GovernorState = {
    autonomy: profile.autonomy,
    postsToday: await deps.activity.countToday(day, 'post'),
    commentsToday: 0,
    reactionsToday: 0,
    turnsInThread: 0,
    lastInThreadIsSelfNoHuman: false,
    dedupHit: isDuplicate(drafted.text, recent),
    limits: profile.limits,
    killSwitch: deps.killSwitch,
  };
  const verdict = evaluateAction(proposed, state);
  if (verdict.verdict === 'reject') {
    await sink.log('govern', `Blocked own post: ${verdict.reason}`, null, drafted.text);
    return false;
  }
  if (verdict.verdict === 'queue') {
    await deps.pending.add(toPending(proposed, `goal: ${goal}`, deps.clock.now()));
    await sink.log('queue', 'Drafted a new post for your approval', null, drafted.text);
    return true;
  }
  await executeProposed(deps, proposed);
  await deps.activity.incrementToday(day, 'post');
  await deps.activity.recordOutput(drafted.text, deps.clock.now(), AgentConfig.dedupHistorySize);
  await sink.log('post', 'Published a new post', null, drafted.text);
  return true;
}
