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
import type { AgentProfile, AgentThresholds } from '@core/agent/AgentProfile';
import { draftReply } from '@core/agent/DecideAction';
import { PostAction, type PostPayload } from '@core/agent/AgentActions';
import { personaCacheKey } from '@core/agent/PersonaCache';
import {
  buildPostPrompt,
  buildPersonaPrefix,
  type EngagementBand,
} from '@core/agent/PromptBuilder';
import { completeJson } from '@core/llm/StructuredLlm';
import { dayKey, isDuplicate, isThreadEcho } from '@core/agent/AgentMemory';
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
  /**
   * Stored cosine similarity to the user (MAX vs own posts / "About you").
   * Drives the engagement band — see `engagementBand`. Null when unscored.
   */
  readonly similarity: number | null;
}

/**
 * Map a candidate's similarity to how far the agent may engage. A post the
 * user is close to can earn a reply; a moderately related one only a reaction;
 * anything weaker (or unscored) is left alone. The thresholds are user-tunable
 * (`AgentProfile.thresholds`) and share the inbox/map similarity vocabulary.
 */
function engagementBand(
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
  /** Mark a candidate as terminally handled so it is never re-evaluated. */
  markSkipped(target: string, createdAt: number): Promise<void>;
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
    refText?: string | null,
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
  /**
   * Threads with an unanswered peer comment that the agent should follow up:
   * the user's own posts, or posts the agent already replied to, where the
   * latest comment is not the agent's and the per-thread turn cap is not yet
   * reached. The `similarity` field is unused for these (engagement is not an
   * affinity question — someone is replying to us).
   */
  listReplyCandidates(limit: number): Promise<AgentCandidate[]>;
  /** Oldest-first text of the thread under `target`, or null. */
  getThreadContext(target: RecordAddress): Promise<string | null>;
  /**
   * Raw texts of the most recent `limit` responses under `target` (both
   * authors, newest-first). Used by the semantic echo gate to compare a drafted
   * reply against what has already been said in the thread.
   */
  getRecentThreadTexts(target: RecordAddress, limit: number): Promise<string[]>;
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

/** Outcome of running one candidate through the decide→govern→act pipeline. */
type CandidateOutcome = 'published' | 'queued' | 'rejected' | 'none';

/**
 * Produce + enforce + execute one action for a candidate. The decision
 * (comment vs react) is ALREADY fixed by the caller's `band`, which is derived
 * purely from similarity — this function never reconsiders whether to act, only
 * produces the artifact: the LLM drafts the reply for the `respond` band, while
 * the `react` band is a deterministic "like" with no LLM call at all.
 *
 * `isReply` governs the anti-loop bookkeeping: a fresh post that can't be
 * drafted or is terminally rejected is marked skipped, but a reply thread is
 * left open so a later peer comment can re-surface it.
 */
async function processCandidate(
  deps: AgentLoopDeps,
  sink: AgentLogSink,
  day: string,
  recent: string[],
  cand: AgentCandidate,
  band: EngagementBand,
  isReply: boolean,
): Promise<CandidateOutcome> {
  const { profile } = deps;
  const short = cand.address.slice(0, 10);

  let proposed: ProposedAction;
  let rationale = '';
  let echoHit = false;
  if (band === 'react') {
    // Deterministic acknowledgement — similarity put us in the react band, so
    // we like it. No LLM, no flavour judgement, fully reproducible.
    proposed = { kind: 'react', target: cand.address, reaction: 'like' };
    console.log(`[agent] react ${short} (deterministic like)`);
  } else {
    const threadContext = await deps.getThreadContext(cand.address);
    const draft = await draftReply({ llm: deps.llm }, profile, cand.text, threadContext);
    console.log(
      `[agent] draft ${short} -> ${draft === null ? 'NULL(parse-fail)' : `"${draft.text.slice(0, 48)}"`}`,
    );
    if (draft === null) {
      // Content failure, not a relevance call: skip a fresh post, keep a reply open.
      if (!isReply) {
        await deps.activity.markSkipped(cand.address, deps.clock.now());
      }
      await sink.log('decide', 'Could not draft a reply (model output unusable)', cand.address, null, cand.text);
      return 'none';
    }
    rationale = draft.rationale;
    proposed = { kind: 'respond', target: cand.address, text: draft.text };

    // Semantic echo gate: would this reply just restate the thread? Embed the
    // draft and the recent thread messages (post + prior responses, both
    // authors) and take the MAX cosine. Catches the reworded agent-echoes-agent
    // loop that the lexical dedup misses. Deterministic — cosine is pure.
    const threadTexts = await deps.getRecentThreadTexts(
      cand.address,
      AgentConfig.novelty.echoLookback,
    );
    const [draftEmb, ...compEmbs] = await Promise.all(
      [draft.text, cand.text, ...threadTexts].map((t) => deps.embedder.embed(t)),
    );
    echoHit = isThreadEcho(draftEmb, compEmbs, profile.thresholds.echoMaxCosine);
    console.log(
      `[agent] echo ${short} -> ${echoHit ? 'SUPPRESS' : 'ok'} (thr=${profile.thresholds.echoMaxCosine})`,
    );

    await sink.log(
      'decide',
      `Drafted a reply${rationale ? ` · ${rationale}` : ''}`,
      cand.address,
      draft.text,
      cand.text,
    );
  }

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
    dedupHit: proposedText.length > 0 && (isDuplicate(proposedText, recent) || echoHit),
    limits: profile.limits,
    killSwitch: deps.killSwitch,
  };

  const verdict = evaluateAction(proposed, state);
  console.log(
    `[agent] verdict ${proposed.kind} -> ${verdict.verdict}${verdict.verdict === 'reject' ? ` reason=${verdict.reason}` : ''}`,
  );
  const actionText = proposed.kind === 'respond' ? proposed.text : null;
  if (verdict.verdict === 'reject') {
    // Terminal rejections (never-list, dedup, per-thread cap) would recur — mark
    // a fresh post skipped. Reply threads are left open (the turn cap bounds
    // them at the query level) so a new peer comment can still re-surface them.
    if (verdict.terminal && !isReply) {
      await deps.activity.markSkipped(cand.address, deps.clock.now());
    }
    await sink.log('govern', `Blocked: ${verdict.reason}`, cand.address, actionText, cand.text);
    return 'rejected';
  }
  if (verdict.verdict === 'queue') {
    if (!(await deps.pending.hasForTarget(cand.address))) {
      await deps.pending.add(toPending(proposed, rationale, deps.clock.now()));
      await sink.log(
        'queue',
        `Drafted a ${proposed.kind === 'react' ? `reaction "${proposed.reaction}"` : 'reply'} for your approval`,
        cand.address,
        actionText,
        cand.text,
      );
      return 'queued';
    }
    return 'none';
  }

  // verdict allow → publish + remember.
  await executeProposed(deps, proposed);
  if (proposed.kind === 'respond') {
    await deps.activity.incrementToday(day, 'comment');
    await deps.activity.recordOutput(proposed.text, deps.clock.now(), AgentConfig.dedupHistorySize);
    recent.unshift(proposed.text);
    await sink.log('publish', isReply ? 'Replied to a comment' : 'Published a reply', cand.address, proposed.text, cand.text);
  } else if (proposed.kind === 'react') {
    await deps.activity.incrementToday(day, 'reaction');
    await sink.log('publish', `Reacted "${proposed.reaction}"`, cand.address, null, cand.text);
  }
  return 'published';
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
      kvCache: personaCacheKey(profile),
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
