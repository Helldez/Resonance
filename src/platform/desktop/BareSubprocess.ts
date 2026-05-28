import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { createRequire } from 'node:module';
import { DesktopConfig } from '@core/config/DesktopConfig';

/**
 * A Duplex-like view on a Bare subprocess. The Bare entry script is
 * launched by the `bare` binary shipped with `bare-runtime`. We don't
 * use stdio for IPC because Windows buffers piped binary stdout of a
 * child until exit — the length-prefixed framed-RPC channel would never
 * flow in real time. Instead we open a loopback TCP server on
 * `127.0.0.1:<random>`, pass the port to the child via `BARE_IPC_PORT`,
 * and the entry script connects back to it.
 *
 * Stdout/stderr of the child are inherited to the host console, so log
 * lines from the Bare worker appear inline with the host's own logs.
 */
export interface BareSubprocessOptions {
  /** Absolute path to the Bare entry file. */
  readonly entryPath: string;
}

export interface DuplexLike {
  on(event: 'data', handler: (chunk: Uint8Array) => void): void;
  write(chunk: Uint8Array): void;
}

export class BareSubprocess implements DuplexLike {
  private child: ChildProcess | null = null;
  private server: Server | null = null;
  private socket: Socket | null = null;
  private readyPromise: Promise<void> | null = null;
  private dataHandlers: Array<(chunk: Uint8Array) => void> = [];
  private exitHandlers: Array<(code: number | null) => void> = [];

  constructor(private readonly options: BareSubprocessOptions) {}

  /**
   * Open the TCP listener, spawn the Bare child, and wait for it to
   * connect back. Resolves once the IPC socket is established and the
   * adapter is ready to send frames.
   */
  async start(): Promise<void> {
    if (this.readyPromise !== null) {
      return this.readyPromise;
    }
    this.readyPromise = this.doStart();
    return this.readyPromise;
  }

  private async doStart(): Promise<void> {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('BareSubprocess: failed to bind loopback TCP port');
    }
    const port = (address as AddressInfo).port;
    this.server = server;

    const accept = new Promise<Socket>((resolve, reject) => {
      const onConn = (sock: Socket): void => {
        server.off('error', onErr);
        resolve(sock);
      };
      const onErr = (err: Error): void => {
        server.off('connection', onConn);
        reject(err);
      };
      server.once('connection', onConn);
      server.once('error', onErr);
    });

    const bin = resolveBareBinary();
    const child = spawn(bin, [this.options.entryPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, BARE_IPC_PORT: String(port) },
      windowsHide: true,
    });
    child.on('exit', (code) => {
      for (const h of this.exitHandlers) {
        h(code);
      }
    });
    this.child = child;

    const socket = await accept;
    // Stop accepting further connections — the framed RPC is single-stream.
    server.close();
    this.server = null;

    socket.on('data', (chunk: Buffer) => {
      const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (const h of this.dataHandlers) {
        h(view);
      }
    });
    socket.on('error', () => {
      // Surface socket errors as a child exit so callers can react uniformly.
      for (const h of this.exitHandlers) {
        h(null);
      }
    });
    this.socket = socket;
  }

  on(event: 'data', handler: (chunk: Uint8Array) => void): void {
    if (event !== 'data') {
      return;
    }
    this.dataHandlers.push(handler);
  }

  onExit(handler: (code: number | null) => void): () => void {
    this.exitHandlers.push(handler);
    return () => {
      this.exitHandlers = this.exitHandlers.filter((h) => h !== handler);
    };
  }

  write(chunk: Uint8Array): void {
    const socket = this.socket;
    if (socket === null) {
      throw new Error('BareSubprocess: not started');
    }
    const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    socket.write(buf);
  }

  async stop(): Promise<void> {
    const child = this.child;
    const socket = this.socket;
    const server = this.server;
    this.child = null;
    this.socket = null;
    this.server = null;
    this.readyPromise = null;

    if (socket !== null) {
      try { socket.end(); } catch { /* ignore */ }
      try { socket.destroy(); } catch { /* ignore */ }
    }
    if (server !== null) {
      try { server.close(); } catch { /* ignore */ }
    }
    if (child === null) {
      return;
    }
    return new Promise<void>((resolve) => {
      const done = (): void => resolve();
      child.once('exit', done);
      const timer = setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }, 1000) as unknown as { unref?: () => void };
      timer.unref?.();
    });
  }
}

/**
 * Locate the `bare` binary via the public `bare-runtime` API. We bypass
 * its `bin/bare` wrapper script because that wrapper hardcodes
 * `stdio: 'inherit'`, which would defeat our env-var hand-off.
 */
function resolveBareBinary(): string {
  const override = process.env[DesktopConfig.bareBinaryEnvVar];
  if (typeof override === 'string' && override.length > 0) {
    return override;
  }
  const req = createRequire(import.meta.url);
  type RuntimeFn = (referrer: string) => string;
  const runtime = req('bare-runtime') as RuntimeFn;
  return runtime('bare');
}
