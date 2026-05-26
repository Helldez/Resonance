import type { RecordBody, SignedRecord } from '@core/domain/types';

/**
 * Canonical serialisation of a record body, used as the input to the
 * signing hash. Stable key order, no whitespace, embeddings encoded as a
 * base64 of the underlying little-endian byte buffer.
 *
 * NB: the actual SHA-256 lives in the platform adapter (no crypto in the
 * core). This file is canonical encoding only.
 */
export function canonicalBytes(body: RecordBody): Uint8Array {
  if (body.kind === 'post') {
    const embeddingB64 = base64FromFloat32(body.embedding);
    const obj = {
      kind: body.kind,
      text: body.text,
      embeddingB64,
      bucket: body.bucket,
      createdAt: body.createdAt,
    };
    return utf8(JSON.stringify(obj));
  }
  const obj = {
    kind: body.kind,
    text: body.text,
    inReplyTo: body.inReplyTo,
    createdAt: body.createdAt,
  };
  return utf8(JSON.stringify(obj));
}

/**
 * Stub for the SHA-256 digest. The platform adapter swaps this out by
 * importing its own `sha256` (bare-crypto on mobile, Web Crypto in tests).
 * Until then, callers receive a clear error.
 */
export async function canonicalDigest(_body: RecordBody): Promise<Uint8Array> {
  throw new Error(
    'canonicalDigest: not wired. Inject sha256 via the platform container.',
  );
}

/** Identity helper: useful when we mutate `feedIndex` after a mailbox append. */
export function signRecord(record: SignedRecord): SignedRecord {
  return record;
}

function utf8(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 4);
  let pos = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out[pos++] = c;
    } else if (c < 0x800) {
      out[pos++] = 0xc0 | (c >> 6);
      out[pos++] = 0x80 | (c & 0x3f);
    } else if ((c & 0xfc00) === 0xd800 && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out[pos++] = 0xf0 | (cp >> 18);
        out[pos++] = 0x80 | ((cp >> 12) & 0x3f);
        out[pos++] = 0x80 | ((cp >> 6) & 0x3f);
        out[pos++] = 0x80 | (cp & 0x3f);
        i++;
        continue;
      }
    } else {
      out[pos++] = 0xe0 | (c >> 12);
      out[pos++] = 0x80 | ((c >> 6) & 0x3f);
      out[pos++] = 0x80 | (c & 0x3f);
    }
  }
  return out.slice(0, pos);
}

function base64FromFloat32(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  // `btoa` is available in all our runtimes (RN, Bare, Node 22+).
  // eslint-disable-next-line no-undef
  return btoa(bin);
}
