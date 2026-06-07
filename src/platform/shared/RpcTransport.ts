/**
 * The transport seam between the app and the Bare P2P worker.
 *
 * Both runtimes already expose the same minimal Duplex-like surface —
 * `react-native-bare-kit`'s `Worklet.IPC` on mobile and `BareSubprocess`
 * on desktop — so the worker adapter (`P2pWorker`) is written once against
 * `RpcTransport` and the only per-platform code left is "how to start and
 * stop the channel" (`RpcTransportHandle`).
 */

/** Minimal byte-stream view of the RPC channel (framed by FramedRpcClient). */
export interface RpcTransport {
  on(event: 'data', handler: (chunk: Uint8Array) => void): void;
  write(chunk: Uint8Array): void;
}

/** Owns the transport lifecycle: construct/connect on start, dispose on stop. */
export interface RpcTransportHandle {
  /** Construct or connect the channel; resolves once it is writable. */
  start(): Promise<RpcTransport>;
  /** Terminate the worklet / kill the subprocess. Idempotent. */
  stop(): Promise<void>;
}
