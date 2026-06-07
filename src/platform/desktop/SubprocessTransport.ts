import { BareSubprocess } from './BareSubprocess';
import type { RpcTransport, RpcTransportHandle } from '@platform/shared/RpcTransport';

/**
 * Desktop transport: spawns the Bare P2P worker as a child process via
 * `BareSubprocess` and hands its duplex view to the shared `P2pWorker`.
 */
export class SubprocessTransport implements RpcTransportHandle {
  private subprocess: BareSubprocess | null = null;

  constructor(private readonly entryPath: string) {}

  async start(): Promise<RpcTransport> {
    const sub = new BareSubprocess({ entryPath: this.entryPath });
    await sub.start();
    this.subprocess = sub;
    return sub;
  }

  async stop(): Promise<void> {
    if (this.subprocess !== null) {
      await this.subprocess.stop();
      this.subprocess = null;
    }
  }
}
