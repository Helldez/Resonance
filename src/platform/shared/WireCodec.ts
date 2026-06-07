import type {
  Announcement,
  PeerId,
  RecordAddress,
  RecordKind,
  ReactionType,
  SignedRecord,
} from '@core/domain/types';
import { bytesToHex, hexToBytes } from '@core/utils/HexEncoding';

/**
 * Single source of the JSON wire shape spoken over the framed RPC channel
 * with the Bare P2P worker (`bare/p2p.mjs`): records and announcements with
 * embeddings as number[] and digest/signature hex-encoded.
 *
 * Field names and casing MUST match `bare/p2p.mjs` exactly — this file and
 * the worker are the two halves of one protocol.
 */

/** Wire form of an announcement (embedding as number[], digest as hex). */
export interface WireAnnouncement {
  readonly outboxKey: string;
  readonly author: string;
  readonly feedIndex: number;
  readonly kind: RecordKind;
  readonly createdAt: number;
  readonly embedding: number[] | null;
  readonly digest: string;
}

export interface WirePostBody {
  readonly kind: 'post';
  readonly text: string;
  readonly embedding: number[];
  readonly createdAt: number;
}

export interface WireResponseBody {
  readonly kind: 'response';
  readonly text: string;
  readonly inReplyTo: string;
  readonly createdAt: number;
}

export interface WireReactionBody {
  readonly kind: 'reaction';
  readonly inReplyTo: string;
  readonly reaction: string;
  readonly createdAt: number;
}

export type WireBody = WirePostBody | WireResponseBody | WireReactionBody;

export interface WireRecord {
  readonly author: string;
  readonly feedIndex: number;
  readonly body: WireBody;
  readonly digest: string;
  readonly signature: string;
}

export function wireToAnnouncement(wire: WireAnnouncement): Announcement {
  return {
    author: wire.author as PeerId,
    feedIndex: wire.feedIndex,
    kind: wire.kind,
    createdAt: wire.createdAt,
    embedding: wire.embedding === null ? null : new Float32Array(wire.embedding),
    digest: hexToBytes(wire.digest),
  };
}

export function signedRecordToWire(record: SignedRecord): WireRecord {
  const body = record.body;
  if (body.kind === 'post') {
    return {
      author: record.author,
      feedIndex: record.feedIndex,
      body: {
        kind: 'post',
        text: body.text,
        embedding: Array.from(body.embedding),
        createdAt: body.createdAt,
      },
      digest: bytesToHex(record.digest),
      signature: bytesToHex(record.signature),
    };
  }
  if (body.kind === 'reaction') {
    return {
      author: record.author,
      feedIndex: record.feedIndex,
      body: {
        kind: 'reaction',
        inReplyTo: String(body.inReplyTo),
        reaction: body.reaction,
        createdAt: body.createdAt,
      },
      digest: bytesToHex(record.digest),
      signature: bytesToHex(record.signature),
    };
  }
  return {
    author: record.author,
    feedIndex: record.feedIndex,
    body: {
      kind: 'response',
      text: body.text,
      inReplyTo: String(body.inReplyTo),
      createdAt: body.createdAt,
    },
    digest: bytesToHex(record.digest),
    signature: bytesToHex(record.signature),
  };
}

export function wireToSignedRecord(wire: WireRecord): SignedRecord {
  const digest = hexToBytes(wire.digest);
  const signature = hexToBytes(wire.signature);
  const author = wire.author as PeerId;
  if (wire.body.kind === 'post') {
    return {
      author,
      feedIndex: wire.feedIndex,
      body: {
        kind: 'post',
        text: wire.body.text,
        embedding: new Float32Array(wire.body.embedding),
        createdAt: wire.body.createdAt,
      },
      digest,
      signature,
    };
  }
  if (wire.body.kind === 'reaction') {
    return {
      author,
      feedIndex: wire.feedIndex,
      body: {
        kind: 'reaction',
        inReplyTo: wire.body.inReplyTo as RecordAddress,
        reaction: wire.body.reaction as ReactionType,
        createdAt: wire.body.createdAt,
      },
      digest,
      signature,
    };
  }
  return {
    author,
    feedIndex: wire.feedIndex,
    body: {
      kind: 'response',
      text: wire.body.text,
      inReplyTo: wire.body.inReplyTo as RecordAddress,
      createdAt: wire.body.createdAt,
    },
    digest,
    signature,
  };
}
