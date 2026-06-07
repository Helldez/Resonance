import type { RecordBody } from '@core/domain/types';

/**
 * Bounds an incoming record body must respect before it is trusted enough to
 * persist. Assembled at the call site from `RoomConfig` (content lengths) and
 * `MatchingConfig` (embedding dimension), so no limit is hard-coded here.
 */
export interface RecordBodyLimits {
  readonly maxPostChars: number;
  readonly maxResponseChars: number;
  readonly embeddingDim: number;
}

export type RecordBodyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate an untrusted record body against hard structural limits.
 *
 * Every field of an incoming record is attacker-controlled: a hostile peer can
 * append a record with an arbitrarily long text or an oversized embedding to
 * exhaust the receiver's memory and disk (a cheap DoS). This check runs at
 * ingestion BEFORE the expensive signature verification — the cheapest reject
 * comes first — and drops anything outside the bounds the rest of the app
 * assumes. A wrong-dimension embedding is also rejected here so it never
 * reaches the matching math (which would skip it silently anyway).
 *
 * Pure and platform-agnostic: char counts via `String.length`, no regex.
 */
export function validateRecordBody(
  body: RecordBody,
  limits: RecordBodyLimits,
): RecordBodyValidation {
  if (body.kind === 'post') {
    if (body.text.length > limits.maxPostChars) {
      return { ok: false, reason: 'post text exceeds maxPostChars' };
    }
    if (body.embedding.length !== limits.embeddingDim) {
      return { ok: false, reason: 'embedding dimension mismatch' };
    }
    return { ok: true };
  }
  if (body.kind === 'response') {
    if (body.text.length > limits.maxResponseChars) {
      return { ok: false, reason: 'response text exceeds maxResponseChars' };
    }
    return { ok: true };
  }
  // Reactions carry no free-form text — `reaction` is constrained to the
  // `ReactionType` enum and `inReplyTo` is an address — so there is nothing
  // length-bound to validate.
  return { ok: true };
}
