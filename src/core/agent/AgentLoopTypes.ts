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
import type { AgentProfile } from '@core/agent/AgentProfile';
import type { ActivityKind, AgentLogPhase } from '@core/agent/ActivityTypes';

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

export const NOOP_LOG: AgentLogSink = { log: () => {} };

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
export type CandidateOutcome = 'published' | 'queued' | 'rejected' | 'none';
