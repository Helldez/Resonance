/**
 * Preload script. Exposes the narrow `window.resonance` surface used by
 * `RemoteContainer` in the renderer:
 *
 *   resonance.call(port, method, args)    →  Promise<result>
 *   resonance.on(channel, handler)        →  () => unsubscribe
 *
 * Structured clone preserves `Uint8Array` and `Float32Array`, so port
 * arguments and results that contain typed arrays (embeddings, digests,
 * signatures) round-trip without manual marshalling.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resonance', {
  call(port, method, args) {
    return ipcRenderer.invoke('container/call', port, method, args);
  },
  on(channel, handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
