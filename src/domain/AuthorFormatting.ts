import type { PeerId } from '@core/domain/types';

/**
 * Human-readable label for a record's author.
 *
 * The user can set a local display name in Settings; it is visible only to
 * them and never published in signed records. For remote peers we always
 * render the truncated public-key fingerprint — Phase 1 does not transmit
 * display names on the wire. This is a deliberate posture choice (see
 * `docs/SEMANTIC_ROUTING.md`): keep identity strictly cryptographic,
 * nicknames stay local.
 */
export function formatAuthor(args: {
  self: PeerId;
  peer: PeerId;
  selfDisplayName: string;
}): string {
  if (args.peer === args.self) {
    const trimmed = args.selfDisplayName.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return shortPeer(args.peer);
}

/**
 * Truncate an opaque peer id to a glance-friendly form `aaaaaa…bbbb`.
 * Used both directly and via `formatAuthor` above.
 */
export function shortPeer(peer: string): string {
  const headLen = 6;
  const tailLen = 4;
  const minFullLen = headLen + tailLen + 2;
  if (peer.length <= minFullLen) {
    return peer;
  }
  return `${peer.slice(0, headLen)}…${peer.slice(-tailLen)}`;
}
