import type { RecordAddress } from '@core/domain/types';
import { scoreAgainstOwn, type OwnEmbedding } from '@core/inbox/ScoreAgainstOwn';

/** A Tier-1 post summary, the minimum the re-ranker needs. */
export interface RerankCandidate {
  readonly address: RecordAddress;
  readonly embedding: Float32Array | null;
  readonly pulled: boolean;
}

export interface RerankConfig {
  readonly capacity: number;
  readonly minSimilarity: number;
}

export interface RerankInput {
  readonly candidates: ReadonlyArray<RerankCandidate>;
  readonly ownEmbeddings: ReadonlyArray<OwnEmbedding>;
  readonly interestProfile: Float32Array | null;
  readonly config: RerankConfig;
}

export interface RerankScore {
  readonly address: RecordAddress;
  readonly similarity: number | null;
}

export interface RerankResult {
  /** Fresh score for every candidate, to persist on the Tier-1 rows. */
  readonly scores: ReadonlyArray<RerankScore>;
  /**
   * Not-yet-pulled summaries that now rank inside the top-`capacity` (and clear
   * the threshold) — the caller pulls these full bodies; each then goes through
   * `IngestPulledPost`, which commits the real admission/eviction against the
   * live inbox.
   */
  readonly toPull: ReadonlyArray<RecordAddress>;
}

/**
 * Re-rank the Tier-1 summaries after the user's own-post set changes (e.g. they
 * just published). Replaces the old worker `rescan` + `rescoreInboxAgainstOwnPosts`:
 * it re-scores cheap summaries instead of re-draining full bodies, and surfaces
 * only the genuinely new winners to pull.
 *
 * Pure: returns the new scores and the pull list; the caller persists scores and
 * issues pulls. A candidate with no usable embedding (stale/missing) scores null
 * and never wins a slot.
 */
export function rerankAnnouncements(input: RerankInput): RerankResult {
  const { candidates, ownEmbeddings, interestProfile, config } = input;

  const scores: RerankScore[] = [];
  const ranked: Array<{ address: RecordAddress; similarity: number; pulled: boolean }> = [];

  for (const cand of candidates) {
    const similarity =
      cand.embedding === null
        ? null
        : scoreAgainstOwn(cand.embedding, ownEmbeddings, interestProfile).similarity;
    scores.push({ address: cand.address, similarity });
    if (similarity !== null && similarity >= config.minSimilarity) {
      ranked.push({ address: cand.address, similarity, pulled: cand.pulled });
    }
  }

  // Highest similarity first; the top `capacity` are the inbox winners.
  ranked.sort((a, b) => b.similarity - a.similarity);
  const winners = ranked.slice(0, config.capacity);
  const toPull = winners.filter((w) => !w.pulled).map((w) => w.address);

  return { scores, toPull };
}
