/**
 * Desktop entry point for the Bare P2P worker.
 *
 * Differences from the mobile path:
 *
 *   1. The mobile bundle is loaded by `react-native-bare-kit`, which
 *      injects `globalThis.BareKit` with a Duplex IPC stream. On desktop
 *      we run the same `p2p.mjs` under the standalone `bare` runtime and
 *      have to synthesise that global ourselves.
 *
 *   2. We **don't** use stdin/stdout for IPC. On Windows the OS buffers
 *      stdout of a child process when stdio is piped, which blocks the
 *      length-prefixed binary framing forever (data only arrives when
 *      the child exits). Instead the Node host opens a loopback TCP
 *      server on `127.0.0.1:<port>`, passes the port via
 *      `BARE_IPC_PORT`, and we connect a `bare-net` socket back to it.
 *      The framed RPC then runs over that socket, leaving stdout/stderr
 *      free for plain text logs.
 *
 *   3. All `console.*` output is routed to stderr so any future migration
 *      back to stdio IPC won't risk corrupting a binary channel.
 */

import process from 'bare-process'
import net from 'bare-net'

// Pre-shim diagnostic so the host can confirm the worker started before
// any later import error. Written to stderr (which the host inherits).
try { process.stderr.write('[entry] boot\n') } catch {}

// Route every console.* call to stderr.
const writeErr = (msg) => {
  try { process.stderr.write(msg + '\n') } catch {}
}
const stringify = (args) => {
  let out = ''
  for (let i = 0; i < args.length; i++) {
    if (i > 0) out += ' '
    const a = args[i]
    if (typeof a === 'string') {
      out += a
    } else if (a instanceof Error) {
      out += a.stack || a.message
    } else {
      try { out += JSON.stringify(a) } catch { out += String(a) }
    }
  }
  return out
}
const route = (args) => writeErr(stringify(args))
console.log = (...a) => route(a)
console.info = (...a) => route(a)
console.warn = (...a) => route(a)
console.error = (...a) => route(a)
console.debug = (...a) => route(a)

const portStr = process.env.BARE_IPC_PORT
if (typeof portStr !== 'string' || portStr.length === 0) {
  writeErr('[entry] FATAL: BARE_IPC_PORT env var not set')
  process.exit(2)
}
const port = Number(portStr)
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  writeErr('[entry] FATAL: invalid BARE_IPC_PORT=' + portStr)
  process.exit(2)
}

writeErr('[entry] connecting IPC socket on 127.0.0.1:' + port)

const socket = net.connect(port, '127.0.0.1')

socket.on('error', (err) => {
  writeErr('[entry] IPC socket error: ' + (err && err.stack || err))
})

await new Promise((resolve) => {
  socket.once('connect', resolve)
})

writeErr('[entry] IPC connected')

// Synthesise BareKit.IPC. p2p.mjs reads `const { IPC } = BareKit` and
// expects a `{ on('data'), write(chunk) }` surface, which `bare-net`'s
// socket already provides verbatim.
globalThis.BareKit = { IPC: socket }

try {
  await import('./p2p.mjs')
  writeErr('[entry] p2p.mjs evaluated')
} catch (err) {
  writeErr('[entry] FATAL importing p2p.mjs: ' + (err && err.stack || err))
  throw err
}
