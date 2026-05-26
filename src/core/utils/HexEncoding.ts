/**
 * Hex encoding/decoding for Uint8Array <-> string. The standard library
 * has no hex helper that works in every runtime we target (Hermes, Bare,
 * Node), so we keep a small self-contained one here.
 */

const HEX_ALPHABET = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_ALPHABET[(b >>> 4) & 0xf];
    out += HEX_ALPHABET[b & 0xf];
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if ((hex.length & 1) !== 0) {
    throw new Error('hexToBytes: odd-length string');
  }
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const hi = hexDigit(hex.charCodeAt(i * 2));
    const lo = hexDigit(hex.charCodeAt(i * 2 + 1));
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  throw new Error(`hexToBytes: invalid hex digit ${String.fromCharCode(code)}`);
}
