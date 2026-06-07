/**
 * Networking parameters. Default Hyperswarm bootstrap = empty array, which
 * means "use the Holepunch public DHT bootstrap nodes baked into the
 * library". An app can override this in dev to point to a local DHT.
 *
 * Room topology (single shared room, connection cap, topic prefix) lives in
 * `RoomConfig`.
 */
export const NetworkConfig = {
  /** Override Hyperswarm bootstrap nodes. Empty = use defaults. */
  bootstrap: [] as ReadonlyArray<{ host: string; port: number }>,
} as const;
