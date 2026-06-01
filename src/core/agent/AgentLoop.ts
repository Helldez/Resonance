import type {
  PeerId,
  RecordAddress,
  SignedRecord,
} from '@core/domain/types';
import type { IClock } from '@core/ports/IClock';
import type { IEmbeddingService } from '@core/ports/IEmbeddingService';
import type { IIdentity } from '@core/ports/IIdentity';
import type { ILlmService } from '@core/ports/ILlmService';
import type { IMailbox } from '@core/ports/IMailbox';
import type { IPeerNetwork } from '@core/ports/IPeerNetwork';
import { AgentConfig } from '@core/config/AgentConfig';
import type { AgentProfile } from '@core/agent/AgentProfile';
import { assessRelevance } from '@core/agent/Triage';
import { decideAction } from '@core/agent/DecideAction';
import {
  buildPostPrompt,
} from '@core/agent/PromptBuilder';
import { completeJson } from '@core/llm/StructuredLlm';
import { dayKey, isDuplicate } from '@core/agent/AgentMemory';
import {
  evaluateAction,
  type GovernorState,
  type ProposedAction,
} from '@core/agent/ActionGovernor';
import { createPost } from '@core/posts/CreatePost';
import { publishResponse } from '@core/responses/PublishResponse';
import { publishReaction } from '@core/reactions/PublishReaction';

/**
 * What the daily caps count. Structurally identical to the data layer's
 * `ActivityKind` so a repository satisfies `ActivityCounters` without the core
 * importing from `@data` (hexagonal boundary).
 */
export type ActivityKind = 'post' | 'comment' | 'reaction';

/** A candidate the agent may act on — a post or thread item from the inbox. */
export interface AgentCandidate {
  readonly address: RecordAddress;
  readonly text: string;
}

/** Bounded item the governor routes to the approval queue in Suggest mode. */
export interface AgentPendingItem {
  readonly id: string;
  readonly kind: 'post' | 'respond' | 'react';
  readonly target: string | null;
  readonly text: string;
  readonly reaction: string | null;
  readonly rationale: string;
  readonly createdAt: number;
}

/** Subset of AgentActivityRepository the loop needs (kept structural). */
export interface ActivityCounters {
  countToday(day: string, kind: ActivityKind): Promise<number>;
  incrementToday(day: string, kind: ActivityKind): Promise<void>;
  recordOutput(text: string, createdAt: number, keep: number): Promise<void>;
  recentOutputs(limit: number): Promise<string[]>;
}

/** Subset of PendingActionRepository the loop needs. */
export interface PendingSink {
  add(item: AgentPendingItem): Promise<void>;
  hasForTarget(target: string): Promise<boolean>;
}

/** Phase of a structured activity event, mirrored by AgentLogRepository. */
export type AgentLogPhase =
  | 'tick'
  | 'triage'
  | 'decide'
  | 'govern'
  | 'publish'
  | 'queue'
  | 'post'
  | 'error';

/**
 * Where the loop reports what it is doing, in real time. Backed by
 * AgentLogRepository so the in-app Activity dashboard can show every decision
 * and its rationale. A no-op default keeps the loop usable without a sink.
 */
export interface AgentLogSink {
  log(
    phase: AgentLogPhase,
    summary: string,
    target?: string | null,
    text?: string | null,
  ): Promise<void> | void;
}

const NOOP_LOG: AgentLogSink = { log: () => {} };

export interface AgentLoopDeps {
  readonly llm: ILlmService;
  readonly embedder: IEmbeddingService;
  readonly mailbox: IMailbox;
  readonly network: IPeerNetwork;
  readonly identity: IIdentity;
  readonly clock: IClock;
  readonly self: PeerId;
  readonly profile: AgentProfile;
  readonly killSwitch: boolean;
  readonly activity: ActivityCounters;
  readonly pending: PendingSink;
  /** Optional activity log for the in-app dashboard. */
  readonly logSink?: AgentLogSink;
  /** Inbox candidates not yet acted on, most relevant first. */
  listCandidates(limit: number): Promise<AgentCandidate[]>;
  /** Oldest-first text of the thread under `target`, or null. */
  getThreadContext(target: RecordAddress): Promise<string | null>;
  /** Agent responses already published under `target`. */
  countAgentTurnsInThread(target: RecordAddress): Promise<number>;
  /** True if the last item under `target` is the agent's, with no human since. */
  lastInThreadIsSelfNoHuman(target: RecordAddress): Promise<boolean>;
  /** Persist the agent's own freshly-published record into the local DB. */
  persistOwn(record: SignedRecord): Promise<void>;
}

export interface TickReport {
  readonly considered: number;
  readonly published: number;
  readonly queued: number;
  readonly rejected: number;
}

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
  const candidates = await deps.listCandidates(AgentConfig.maxCandidatesPerTick);
  const recent = await deps.activity.recentOutputs(AgentConfig.dedupHistorySize);
  console.log(`[agent] candidates=${candidates.length} recentDedup=${recent.length} autonomy=${profile.autonomy}`);
  await sink.log('tick', `Woke up · ${candidates.length} posts to consider · mode ${profile.autonomy}`);

  let published = 0;
  let queued = 0;
  let rejected = 0;

  for (const cand of candidates) {
    const short = cand.address.slice(0, 10);
    const triage = await assessRelevance({ llm: deps.llm }, profile, cand.text);
    console.log(
      `[agent] triage ${short} -> ${triage === null ? 'NULL(parse-fail)' : `relevant=${triage.relevant} score=${triage.score.toFixed(2)} thr=${AgentConfig.triageScoreThreshold}`}`,
    );
    if (triage === null) {
      await sink.log('triage', 'Could not read the post (model output unparseable)', cand.address, cand.text);
      continue;
    }
    await sink.log(
      'triage',
      `Relevance ${(triage.score * 100).toFixed(0)}% (need ${(AgentConfig.triageScoreThreshold * 100).toFixed(0)}%)${triage.reason ? ` — ${triage.reason}` : ''}`,
      cand.address,
      cand.text,
    );
    if (!triage.relevant || triage.score < AgentConfig.triageScoreThreshold) {
      continue;
    }
    const threadContext = await deps.getThreadContext(cand.address);
    const decision = await decideAction({ llm: deps.llm }, profile, cand.text, threadContext);
    console.log(
      `[agent] decide ${short} -> ${decision === null ? 'NULL(parse-fail)' : `action=${decision.action}${decision.reaction ? ` react=${decision.reaction}` : ''}`}`,
    );
    if (decision === null) {
      await sink.log('decide', 'Could not decide (model output unparseable)', cand.address);
      continue;
    }
    if (decision.action === 'do_nothing') {
      await sink.log('decide', `Chose to do nothing${decision.rationale ? ` — ${decision.rationale}` : ''}`, cand.address);
      continue;
    }
    await sink.log(
      'decide',
      `Wants to ${decision.action === 'react' ? `react "${decision.reaction}"` : 'reply'}${decision.rationale ? ` — ${decision.rationale}` : ''}`,
      cand.address,
      decision.action === 'respond' ? decision.text : null,
    );

    const proposed: ProposedAction =
      decision.action === 'react' && decision.reaction !== null
        ? { kind: 'react', target: cand.address, reaction: decision.reaction }
        : decision.action === 'respond'
          ? { kind: 'respond', target: cand.address, text: decision.text }
          : { kind: 'none' };

    const proposedText = proposed.kind === 'respond' ? proposed.text : '';
    const state: GovernorState = {
      autonomy: profile.autonomy,
      postsToday: await deps.activity.countToday(day, 'post'),
      commentsToday: await deps.activity.countToday(day, 'comment'),
      reactionsToday: await deps.activity.countToday(day, 'reaction'),
      turnsInThread:
        proposed.kind === 'respond' ? await deps.countAgentTurnsInThread(proposed.target) : 0,
      lastInThreadIsSelfNoHuman:
        proposed.kind === 'respond' ? await deps.lastInThreadIsSelfNoHuman(proposed.target) : false,
      dedupHit: proposedText.length > 0 && isDuplicate(proposedText, recent),
      limits: profile.limits,
      killSwitch: deps.killSwitch,
    };

    const verdict = evaluateAction(proposed, state);
    console.log(
      `[agent] verdict ${proposed.kind} -> ${verdict.verdict}${verdict.verdict === 'reject' ? ` reason=${verdict.reason}` : ''}`,
    );
    const actionText = proposed.kind === 'respond' ? proposed.text : null;
    if (verdict.verdict === 'reject') {
      await sink.log('govern', `Blocked: ${verdict.reason}`, cand.address, actionText);
      rejected++;
      continue;
    }
    if (verdict.verdict === 'queue') {
      if (proposed.kind !== 'none' && !(await deps.pending.hasForTarget(cand.address))) {
        await deps.pending.add(toPending(proposed, decision.rationale, deps.clock.now()));
        await sink.log(
          'queue',
          `Drafted a ${proposed.kind === 'react' ? `reaction "${proposed.reaction}"` : 'reply'} for your approval`,
          cand.address,
          actionText,
        );
        queued++;
      }
      continue;
    }

    // verdict allow → publish + remember.
    await executeProposed(deps, proposed);
    if (proposed.kind === 'respond') {
      await deps.activity.incrementToday(day, 'comment');
      await deps.activity.recordOutput(proposed.text, deps.clock.now(), AgentConfig.dedupHistorySize);
      recent.unshift(proposed.text);
      await sink.log('publish', 'Published a reply', cand.address, proposed.text);
    } else if (proposed.kind === 'react') {
      await deps.activity.incrementToday(day, 'reaction');
      await sink.log('publish', `Reacted "${proposed.reaction}"`, cand.address);
    }
    published++;
  }

  return { considered: candidates.length, published, queued, rejected };
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
  const goal = profile.goals[0];
  const drafted = await completeJson<{ text: string }>(
    { llm: deps.llm },
    buildPostPrompt(profile, goal),
    (v) => {
      if (typeof v !== 'object' || v === null) {
        return null;
      }
      const t = (v as Record<string, unknown>).text;
      const text = typeof t === 'string' ? t.trim().slice(0, 280) : '';
      return text.length > 0 ? { text } : null;
    },
    { temperature: AgentConfig.textTemperature, maxTokens: AgentConfig.postMaxTokens },
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

async function executeProposed(deps: AgentLoopDeps, proposed: ProposedAction): Promise<void> {
  const publishDeps = {
    mailbox: deps.mailbox,
    network: deps.network,
    identity: deps.identity,
    clock: deps.clock,
    self: deps.self,
  };
  if (proposed.kind === 'post') {
    const { record } = await createPost({ ...publishDeps, embedder: deps.embedder }, { text: proposed.text });
    await deps.persistOwn(record);
    return;
  }
  if (proposed.kind === 'respond') {
    const record = await publishResponse(publishDeps, {
      text: proposed.text,
      inReplyTo: proposed.target,
    });
    await deps.persistOwn(record);
    return;
  }
  if (proposed.kind === 'react') {
    const record = await publishReaction(publishDeps, {
      inReplyTo: proposed.target,
      reaction: proposed.reaction,
    });
    await deps.persistOwn(record);
  }
}

function toPending(
  proposed: ProposedAction,
  rationale: string,
  now: number,
): AgentPendingItem {
  const target = proposed.kind === 'respond' || proposed.kind === 'react' ? proposed.target : null;
  const text = proposed.kind === 'post' || proposed.kind === 'respond' ? proposed.text : '';
  const reaction = proposed.kind === 'react' ? proposed.reaction : null;
  const kind = proposed.kind === 'none' ? 'respond' : proposed.kind;
  return {
    id: `${now}:${kind}:${target ?? 'post'}`,
    kind,
    target,
    text,
    reaction,
    rationale,
    createdAt: now,
  };
}
