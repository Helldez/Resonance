/** Ed25519 public key, hex-encoded. */
export type PeerId = string & { readonly __brand: 'PeerId' };

/** Address of a record inside a peer's feed: `<peerId>:<feedIndex>`. */
export type RecordAddress = string & { readonly __brand: 'RecordAddress' };

export type RecordKind = 'post' | 'response' | 'reaction';

/**
 * The reaction vocabulary. Collapsed to a single "like": the agent only ever
 * liked, and the four-type picker added no real value. The field stays in the
 * signed `ReactionBody`, so the wire format is unchanged (a 'like' serialises
 * the same) — no topicPrefix bump needed.
 */
export type ReactionType = 'like';

export const REACTION_TYPES: ReadonlyArray<ReactionType> = ['like'];

export interface PostBody {
  readonly kind: 'post';
  readonly text: string;
  readonly embedding: Float32Array;
  readonly createdAt: number;
}

export interface ResponseBody {
  readonly kind: 'response';
  readonly text: string;
  readonly inReplyTo: RecordAddress;
  readonly createdAt: number;
}

/**
 * A signed reaction to a post or a response. `inReplyTo` addresses the target
 * record. One reaction per (author, target) is kept by the receiver — a newer
 * reaction from the same author replaces the older one (lets a peer change
 * their reaction). Reactions are tiny and carry no embedding.
 */
export interface ReactionBody {
  readonly kind: 'reaction';
  readonly inReplyTo: RecordAddress;
  readonly reaction: ReactionType;
  readonly createdAt: number;
}

export type RecordBody = PostBody | ResponseBody | ReactionBody;

/** A record after signing, ready for the wire and for storage. */
export interface SignedRecord {
  readonly author: PeerId;
  readonly feedIndex: number;
  readonly body: RecordBody;
  /** Canonical-JSON SHA-256 of `body`. */
  readonly digest: Uint8Array;
  /** Ed25519 signature of `digest` by `author`. */
  readonly signature: Uint8Array;
}

/** Returned by ScoreIncomingPost when a post passes the local threshold. */
export interface ScoredPost {
  readonly address: RecordAddress;
  readonly post: PostBody;
  readonly author: PeerId;
  readonly similarity: number;
}

/**
 * A lightweight summary of a record, gossiped ahead of its full body in the
 * announce-then-pull model. Every peer receives every announcement (cheap, like
 * the outbox keys did before) and ranks posts locally on `embedding` WITHOUT
 * downloading them. Only the records that win a bounded-inbox slot are then
 * pulled in full and signature-verified — see `IngestAnnouncement` /
 * `IngestPulledPost`.
 *
 * The announcement is NOT trusted on its own: `embedding` is used only to make
 * a tentative admission decision. Authenticity is established after the pull,
 * when the full body's canonical digest is recomputed and the author's Ed25519
 * signature is verified; the post is then re-scored on its VERIFIED embedding,
 * so a lying announcement cannot get a mismatched post stored (closes S2).
 */
export interface Announcement {
  readonly author: PeerId;
  readonly feedIndex: number;
  readonly kind: RecordKind;
  readonly createdAt: number;
  /**
   * Full-precision L2-normalised embedding for posts; `null` for responses and
   * reactions (which carry no embedding and are always pulled, being tiny and
   * thread-relevant). Full float32 is carried deliberately: it keeps the global
   * ranking bit-identical to scoring the post itself. Quantisation (int8) is a
   * future bandwidth optimisation, not used here.
   */
  readonly embedding: Float32Array | null;
  /** Canonical-JSON SHA-256 of the announced record's body. */
  readonly digest: Uint8Array;
}
