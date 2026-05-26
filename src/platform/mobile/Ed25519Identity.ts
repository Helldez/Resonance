import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import type { PeerId } from '@core/domain/types';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IKeyValueStore } from '@core/ports/IKeyValueStore';
import { StorageConfig } from '@core/config/StorageConfig';
import { bytesToHex, hexToBytes } from '@core/utils/HexEncoding';

/**
 * Ed25519 identity backed by @noble/ed25519 (pure JS, works in Hermes and
 * Bare). The private seed is stored hex-encoded under
 * `StorageConfig.identityKvKey`. The public key, also hex-encoded, is the
 * `PeerId` used throughout the app.
 *
 * The keypair is generated locally on first launch and never leaves the
 * device.
 */
export class Ed25519Identity implements IIdentity {
  private cached: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
    peerId: PeerId;
  } | null = null;

  constructor(private readonly kv: IKeyValueStore) {
    // @noble/ed25519 v2 requires injecting a hash for sync APIs. We only
    // use async APIs but pinning sha512 prevents surprises if a sync path
    // is added later.
    ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
  }

  async loadOrCreate(): Promise<PeerId> {
    if (this.cached !== null) {
      return this.cached.peerId;
    }
    const stored = await this.kv.get(StorageConfig.identityKvKey);
    if (stored !== null) {
      const privateKey = hexToBytes(stored);
      const publicKey = await ed.getPublicKey(privateKey);
      this.cached = {
        privateKey,
        publicKey,
        peerId: bytesToHex(publicKey) as PeerId,
      };
      return this.cached.peerId;
    }
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKey(privateKey);
    await this.kv.set(StorageConfig.identityKvKey, bytesToHex(privateKey));
    this.cached = {
      privateKey,
      publicKey,
      peerId: bytesToHex(publicKey) as PeerId,
    };
    return this.cached.peerId;
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    const c = await this.requireCached();
    return ed.sign(payload, c.privateKey);
  }

  async verify(
    payload: Uint8Array,
    signature: Uint8Array,
    publicKey: PeerId,
  ): Promise<boolean> {
    return ed.verify(signature, payload, hexToBytes(publicKey));
  }

  private async requireCached(): Promise<NonNullable<typeof this.cached>> {
    if (this.cached === null) {
      await this.loadOrCreate();
    }
    if (this.cached === null) {
      throw new Error('Ed25519Identity: keypair unavailable');
    }
    return this.cached;
  }
}
