/**
 * Framed JSON message protocol used by both the Bare worker and the RN
 * side. Format on the wire is:
 *
 *   <4-byte BE uint32 length> <UTF-8 JSON payload>
 *
 * Payloads are one of:
 *   { id: number, method: string, params: any }         // request
 *   { id: number, ok: true,  result: any }              // success reply
 *   { id: number, ok: false, error: string }            // failure reply
 *   { event: string, payload: any }                     // push event from worker
 *
 * The implementation is self-contained — no `bare-rpc` dependency — so it
 * runs identically in Bare and in Hermes (RN).
 */

export class FramedRpc {
  constructor(stream, onRequest) {
    this._stream = stream;
    this._onRequest = onRequest;
    this._buffer = Buffer.alloc(0);
    this._pending = new Map();
    this._nextId = 1;
    this._eventHandlers = new Map();

    stream.on('data', (chunk) => this._onData(chunk));
  }

  request(method, params) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._send({ id, method, params });
    });
  }

  reply(id, result) {
    this._send({ id, ok: true, result });
  }

  fail(id, error) {
    this._send({ id, ok: false, error: String(error?.message ?? error) });
  }

  emit(event, payload) {
    this._send({ event, payload });
  }

  on(event, handler) {
    let list = this._eventHandlers.get(event);
    if (list === undefined) {
      list = [];
      this._eventHandlers.set(event, list);
    }
    list.push(handler);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
    };
  }

  _send(obj) {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const frame = Buffer.alloc(4 + json.length);
    frame.writeUInt32BE(json.length, 0);
    json.copy(frame, 4);
    this._stream.write(frame);
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    while (this._buffer.length >= 4) {
      const len = this._buffer.readUInt32BE(0);
      if (this._buffer.length < 4 + len) {
        return;
      }
      const json = this._buffer.subarray(4, 4 + len).toString('utf8');
      this._buffer = this._buffer.subarray(4 + len);
      let msg;
      try {
        msg = JSON.parse(json);
      } catch (e) {
        continue;
      }
      this._handle(msg);
    }
  }

  _handle(msg) {
    if (typeof msg.event === 'string') {
      const handlers = this._eventHandlers.get(msg.event);
      if (handlers !== undefined) {
        for (const h of handlers) {
          h(msg.payload);
        }
      }
      return;
    }
    if (typeof msg.id === 'number') {
      if (msg.method !== undefined) {
        this._handleRequest(msg);
        return;
      }
      const pending = this._pending.get(msg.id);
      if (pending === undefined) {
        return;
      }
      this._pending.delete(msg.id);
      if (msg.ok === true) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(msg.error ?? 'unknown error'));
      }
    }
  }

  async _handleRequest(msg) {
    if (this._onRequest === undefined) {
      this.fail(msg.id, new Error('no handler'));
      return;
    }
    try {
      const result = await this._onRequest(msg.method, msg.params);
      this.reply(msg.id, result);
    } catch (e) {
      this.fail(msg.id, e);
    }
  }
}
