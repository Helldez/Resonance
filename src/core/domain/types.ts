/** Ed25519 public key, hex-encoded. */
export type PeerId = string & { readonly __brand: 'PeerId' };

/** LSH bucket id, hex-encoded. */
export type BucketId = string & { readonly __brand: 'BucketId' };

/** Address of a record inside a peer's feed: `<peerId>:<feedIndex>`. */
export type RecordAddress = string & { readonly __brand: 'RecordAddress' };

export type RecordKind = 'post' | 'response';

export interface PostBody {
  readonly kind: 'post';
  readonly text: string;
  readonly embedding: Float32Array;
  readonly bucket: BucketId;
  readonly createdAt: number;
  /**
   * Author's Hyperswarm noise public key (hex), if known at compose time.
   * Optional for backward compatibility — pre-existing posts in older
   * databases will not have it. When present, any peer that receives this
   * post can dial the author directly via `swarm.joinPeer(noiseKey)` and
   * keep a connection alive regardless of bucket co-membership. This is
   * the "deliverability layer" that complements the bucket-based
   * "discoverability layer" — see `docs/SEMANTIC_ROUTING.md` §11.
   */
  readonly authorNoiseKey?: string;
}

export interface ResponseBody {
  readonly kind: 'response';
  readonly text: string;
  readonly inReplyTo: RecordAddress;
  readonly createdAt: number;
}

export type RecordBody = PostBody | ResponseBody;

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
