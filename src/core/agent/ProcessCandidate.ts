import { AgentConfig } from '@core/config/AgentConfig';
import { draftReply } from '@core/agent/DecideAction';
import type { EngagementBand } from '@core/agent/PromptBuilder';
import { isDuplicate, isThreadEcho } from '@core/agent/AgentMemory';
import {
  evaluateAction,
  type GovernorState,
  type ProposedAction,
} from '@core/agent/ActionGovernor';
import { createPost } from '@core/posts/CreatePost';
import { publishResponse } from '@core/responses/PublishResponse';
import { publishReaction } from '@core/reactions/PublishReaction';
import type {
  AgentCandidate,
  AgentLoopDeps,
  AgentLogSink,
  AgentPendingItem,
  CandidateOutcome,
} from '@core/agent/AgentLoopTypes';

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
export async function processCandidate(
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

  // Don't spend an LLM draft (or any proposal) on an action class whose daily
  // cap is already exhausted — in autopilot the governor would only reject it
  // afterwards, wasting the generation. The candidate is NOT marked skipped:
  // caps reset at midnight, so it stays eligible for a future tick. Suggest
  // mode is exempt (it queues for a human, mirroring the governor's own
  // cap semantics).
  if (profile.autonomy === 'autopilot') {
    if (band === 'respond') {
      const commentsToday = await deps.activity.countToday(day, 'comment');
      if (commentsToday >= profile.limits.maxCommentsPerDay) {
        console.log(`[agent] defer ${short}: comment cap reached, no draft spent`);
        await sink.log('govern', 'Daily comment cap reached — deferred without drafting', cand.address, null, cand.text);
        return 'none';
      }
    } else {
      const reactionsToday = await deps.activity.countToday(day, 'reaction');
      if (reactionsToday >= profile.limits.maxReactionsPerDay) {
        console.log(`[agent] defer ${short}: reaction cap reached`);
        await sink.log('govern', 'Daily reaction cap reached — deferred', cand.address, null, cand.text);
        return 'none';
      }
    }
  }

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

export async function executeProposed(deps: AgentLoopDeps, proposed: ProposedAction): Promise<void> {
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

export function toPending(
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
