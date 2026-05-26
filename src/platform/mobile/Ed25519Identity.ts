import type { PeerId } from '@core/domain/types';
import type { IIdentity } from '@core/ports/IIdentity';
import type { IKeyValueStore } from '@core/ports/IKeyValueStore';
import { StorageConfig } from '@core/config/StorageConfig';

/**
 * Ed25519 identity backed by the Bare worklet's `bare-crypto`. The
 * keypair is persisted under `StorageConfig.identityKvKey`. This RN-side
 * class is a thin facade that proxies to the worklet for actual signing.
 *
 * Stub for now — wired in Milestone 1.
 */
export class Ed25519Identity implements IIdentity {
  constructor(private readonly kv: IKeyValueStore) {}

  async loadOrCreate(): Promise<PeerId> {
    const existing = await this.kv.get(StorageConfig.identityKvKey);
    if (existing !== null) {
      // TODO M1: parse stored keypair, return public key as PeerId
      return 'TODO_PEER_ID' as PeerId;
    }
    // TODO M1: ask worklet to generate keypair, store, return public key.
    throw new Error('Ed25519Identity.loadOrCreate: not implemented (M1)');
  }

  async sign(_payload: Uint8Array): Promise<Uint8Array> {
    throw new Error('Ed25519Identity.sign: not implemented (M1)');
  }

  async verify(
    _payload: Uint8Array,
    _signature: Uint8Array,
    _publicKey: PeerId,
  ): Promise<boolean> {
    throw new Error('Ed25519Identity.verify: not implemented (M1)');
  }
}
