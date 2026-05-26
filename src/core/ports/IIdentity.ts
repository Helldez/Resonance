import type { PeerId } from '@core/domain/types';

/**
 * Persistent Ed25519 identity. Created once, kept in the platform's secure
 * key-value store. The public key is the peer id used throughout the app.
 */
export interface IIdentity {
  /** Return existing identity, or create one if none. */
  loadOrCreate(): Promise<PeerId>;

  /** Sign a payload with the private key. */
  sign(payload: Uint8Array): Promise<Uint8Array>;

  /** Verify a signature with a peer's public key. */
  verify(payload: Uint8Array, signature: Uint8Array, publicKey: PeerId): Promise<boolean>;
}
