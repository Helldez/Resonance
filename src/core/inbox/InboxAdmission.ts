import type { RecordAddress } from '@core/domain/types';

/**
 * Bounded top-K inbox admission — the local-inbox rule of the single-room
 * ("Keet model", ResonanceSim conf 9) design.
 *
 * Every remote post is broadcast to the whole room, so each node must decide
 * locally whether an incoming post earns a slot in its bounded inbox:
 *
 *   1. Drop posts below the admission threshold outright (noise filter).
 *   2. While under capacity, admit unconditionally.
 *   3. When full, replace the lowest-similarity occupant — but only if the
 *      newcomer scores strictly higher. Otherwise drop the newcomer.
 *
 * This mirrors the broadcast-room delivery loop in ResonanceSim's `Tick.ts`.
 * The function is pure so it can be unit-tested in isolation; the caller owns
 * the SQLite side effects (count, find-min, delete, insert).
 */
export interface InboxAdmissionConfig {
  /** Maximum number of remote posts kept locally (`RoomConfig.inboxCapacity`). */
  readonly capacity: number;
  /** Minimum cosine similarity to admit (`RoomConfig.inboxMinSimilarity`). */
  readonly minSimilarity: number;
}

/** The current lowest-ranked remote post in the inbox, if any. */
export interface InboxMinEntry {
  readonly address: RecordAddress;
  readonly similarity: number;
}

export type AdmissionDecision =
  /** Below the admission threshold (or unscorable) — do not store. */
  | { readonly kind: 'reject-threshold' }
  /** Capacity available — store the post. */
  | { readonly kind: 'admit' }
  /** Inbox full, newcomer beats the weakest — evict `evict`, then store. */
  | { readonly kind: 'replace'; readonly evict: RecordAddress }
  /** Inbox full, newcomer does not beat the weakest — do not store. */
  | { readonly kind: 'reject-full' };

export interface AdmissionInput {
  /** Newcomer's similarity to the user's own posts; `null` = unscorable. */
  readonly similarity: number | null;
  /** How many remote posts are currently in the inbox. */
  readonly currentCount: number;
  /** The current weakest remote post, or `null` when the inbox is empty. */
  readonly min: InboxMinEntry | null;
  readonly config: InboxAdmissionConfig;
}

export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  const { similarity, currentCount, min, config } = input;

  if (similarity === null || similarity < config.minSimilarity) {
    return { kind: 'reject-threshold' };
  }

  if (currentCount < config.capacity) {
    return { kind: 'admit' };
  }

  // Inbox full: replace the weakest only if the newcomer scores strictly
  // higher. Ties keep the incumbent to avoid pointless churn.
  if (min !== null && similarity > min.similarity) {
    return { kind: 'replace', evict: min.address };
  }
  return { kind: 'reject-full' };
}
