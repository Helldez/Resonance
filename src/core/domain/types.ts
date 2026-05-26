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
