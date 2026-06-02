import type { SignedRecord } from '@core/domain/types';
import {
  decideAdmission,
  type AdmissionDecision,
  type InboxAdmissionConfig,
  type InboxMinEntry,
} from '@core/inbox/InboxAdmission';
import { scoreAgainstOwn, type OwnEmbedding, type OwnScore } from '@core/inbox/ScoreAgainstOwn';

export interface IngestPulledPostInput {
  /**
   * The pulled record, ALREADY signature-verified by the caller (digest
   * recomputed, Ed25519 checked). This use-case establishes relevance, not
   * authenticity.
   */
  readonly record: SignedRecord;
  readonly ownEmbeddings: ReadonlyArray<OwnEmbedding>;
  readonly interestProfile: Float32Array | null;
  readonly currentInboxCount: number;
  readonly inboxMin: InboxMinEntry | null;
  readonly config: InboxAdmissionConfig;
}

export type IngestPulledPostResult =
  /**
   * A post: re-scored on its VERIFIED embedding and re-judged against the
   * CURRENT inbox. The caller commits the decision (evict on `replace`, then
   * upsert; nothing on `reject-*`). Re-scoring here — not trusting the
   * announcement's score — is what closes S2: a lying announcement that won a
   * tentative slot is dropped now if the real embedding does not earn it.
   */
  | { readonly kind: 'post'; readonly decision: AdmissionDecision; readonly score: OwnScore }
  /**
   * A response or reaction: no scoring, the caller stores it directly into the
   * thread projection (responses/reactions tables).
   */
  | { readonly kind: 'thread' };

/**
 * Commit decision for a verified, pulled record. Pure — the caller performs the
 * SQLite writes (and marks the Tier-1 row pulled). Mirrors the post branch of
 * the old `persistRecord`, but driven by the verified body rather than the
 * announcement.
 */
export function ingestPulledPost(input: IngestPulledPostInput): IngestPulledPostResult {
  const body = input.record.body;
  if (body.kind !== 'post') {
    return { kind: 'thread' };
  }

  const score = scoreAgainstOwn(body.embedding, input.ownEmbeddings, input.interestProfile);
  const decision = decideAdmission({
    similarity: score.similarity,
    currentCount: input.currentInboxCount,
    min: input.inboxMin,
    config: input.config,
  });
  return { kind: 'post', decision, score };
}
