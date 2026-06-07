import { Buffer } from 'buffer';
import type { RpcTransport } from './RpcTransport';

/**
 * App-side companion to bare/rpc-frame.mjs. Wraps any `RpcTransport`
 * (Worklet IPC on mobile, BareSubprocess on desktop — the `buffer` package
 * is an exact Buffer polyfill on Hermes and a passthrough on Node) and
 * exposes a typed request/event API.
 *
 * Wire format (must match the Bare worker exactly):
 *   <4-byte BE uint32 length> <UTF-8 JSON payload>
 */

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type EventHandler<T = unknown> = (payload: T) => void;

export class FramedRpcClient {
  private buffer = new Uint8Array(0);
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private handlers = new Map<string, Array<EventHandler<unknown>>>();

  constructor(private readonly stream: RpcTransport) {
    stream.on('data', (chunk) => this.onData(chunk));
  }

  async request<TResult = unknown, TParams = unknown>(
    method: string,
    params: TParams,
  ): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as TResult),
        reject,
      });
      this.send({ id, method, params });
    });
  }

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    let list = this.handlers.get(event);
    if (list === undefined) {
      list = [];
      this.handlers.set(event, list);
    }
    list.push(handler as EventHandler<unknown>);
    return () => {
      const i = list!.indexOf(handler as EventHandler<unknown>);
      if (i >= 0) {
        list!.splice(i, 1);
      }
    };
  }

  private send(obj: Record<string, unknown>): void {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const frame = Buffer.alloc(4 + json.length);
    frame.writeUInt32BE(json.length, 0);
    json.copy(frame, 4);
    this.stream.write(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  }

  private onData(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.length);
    this.buffer = next;

    while (this.buffer.length >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const len = view.getUint32(0, false);
      if (this.buffer.length < 4 + len) {
        return;
      }
      const payload = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(Buffer.from(payload).toString('utf8')) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (typeof msg.event === 'string') {
      const list = this.handlers.get(msg.event);
      if (list !== undefined) {
        for (const h of list) {
          h(msg.payload);
        }
      }
      return;
    }
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(msg.id);
      if (msg.ok === true) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(String(msg.error ?? 'unknown error')));
      }
    }
  }
}
