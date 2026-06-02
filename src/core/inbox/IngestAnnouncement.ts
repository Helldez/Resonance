import type { Announcement } from '@core/domain/types';
import {
  decideAdmission,
  type AdmissionDecision,
  type InboxAdmissionConfig,
  type InboxMinEntry,
} from '@core/inbox/InboxAdmission';
import { scoreAgainstOwn, type OwnEmbedding, type OwnScore } from '@core/inbox/ScoreAgainstOwn';

export interface IngestAnnouncementInput {
  readonly announcement: Announcement;
  readonly ownEmbeddings: ReadonlyArray<OwnEmbedding>;
  readonly interestProfile: Float32Array | null;
  /** Remote posts currently in the bounded inbox (Tier-2). */
  readonly currentInboxCount: number;
  /** The weakest occupant of the inbox, or null when not full. */
  readonly inboxMin: InboxMinEntry | null;
  readonly config: InboxAdmissionConfig;
}

export interface IngestAnnouncementResult {
  /** Score to persist on the Tier-1 row (drives the re-rank ordering). */
  readonly score: OwnScore;
  /** Tentative admission verdict, based on the UNVERIFIED announced embedding. */
  readonly decision: AdmissionDecision;
  /**
   * Whether the caller should pull the full body. True for any post that would
   * be admitted/replaced, and ALWAYS for non-post records (responses/reactions
   * carry no embedding and are tiny and thread-relevant). The pull is where
   * authenticity is established — nothing here is trusted yet.
   */
  readonly shouldPull: boolean;
}

/**
 * Receive-side decision for a single Tier-1 announcement.
 *
 * Pure: it scores the announced (UNVERIFIED) embedding against the user's own
 * posts and runs the bounded top-K admission rule, returning what to persist
 * and whether to pull. The caller owns the side effects — upsert the Tier-1 row
 * with `score`, and if `shouldPull` is true, request the full body. The
 * tentative `decision` must NOT be committed to the Tier-2 inbox here: the
 * announced embedding is attacker-controlled, so eviction/storage only happen
 * after the pulled body is verified and re-scored (`IngestPulledPost`).
 *
 * Non-post announcements skip scoring (no embedding) and are always pulled.
 */
export function ingestAnnouncement(input: IngestAnnouncementInput): IngestAnnouncementResult {
  const { announcement } = input;

  if (announcement.kind !== 'post' || announcement.embedding === null) {
    return {
      score: { similarity: null, matchedOwnAddress: null },
      decision: { kind: 'admit' },
      shouldPull: true,
    };
  }

  const score = scoreAgainstOwn(
    announcement.embedding,
    input.ownEmbeddings,
    input.interestProfile,
  );
  const decision = decideAdmission({
    similarity: score.similarity,
    currentCount: input.currentInboxCount,
    min: input.inboxMin,
    config: input.config,
  });
  const shouldPull = decision.kind === 'admit' || decision.kind === 'replace';
  return { score, decision, shouldPull };
}
