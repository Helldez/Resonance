import type { PeerId } from '@core/domain/types';
import type { IIdentity } from '@core/ports/IIdentity';

export interface IdentityManagerDeps {
  readonly identity: IIdentity;
}

export interface IdentityManagerState {
  readonly self: PeerId;
}

/**
 * One-shot bootstrap of the local identity. The adapter behind
 * `IIdentity.loadOrCreate` is responsible for persistence; this use case
 * just exposes the resulting peer id.
 */
export async function bootstrapIdentity(
  deps: IdentityManagerDeps,
): Promise<IdentityManagerState> {
  const self = await deps.identity.loadOrCreate();
  return { self };
}
