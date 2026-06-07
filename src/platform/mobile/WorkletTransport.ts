import bundle from '../../../bare/p2p.bundle.mjs';

import { Worklet } from 'react-native-bare-kit';
import type { RpcTransport, RpcTransportHandle } from '@platform/shared/RpcTransport';

/**
 * Mobile transport: hosts the Bare P2P worker inside a
 * `react-native-bare-kit` Worklet and hands its IPC duplex to the shared
 * `P2pWorker`. This file owns the bundle + react-native-bare-kit imports
 * so no React Native dependency leaks into `@platform/shared`.
 */
export class WorkletTransport implements RpcTransportHandle {
  private worklet: Worklet | null = null;

  async start(): Promise<RpcTransport> {
    const worklet = new Worklet();
    worklet.start('/p2p.bundle', bundle);
    this.worklet = worklet;
    return worklet.IPC as unknown as RpcTransport;
  }

  async stop(): Promise<void> {
    if (this.worklet !== null) {
      this.worklet.terminate();
      this.worklet = null;
    }
  }
}
