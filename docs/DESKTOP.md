# Desktop target — runbook & architecture

> Status: **experimental** (Android remains the MVP and the only
> first-class target). The desktop peer is a development/testing aid — it
> exists so a contributor can run a second Resonance node on a development
> machine and exercise the P2P matching path end-to-end without provisioning
> a second phone. Expect rough edges; it is not a shipped product surface.

## Architecture

The hexagonal core (`src/core/**`, `src/data/**`) and the Bare P2P worker
(`bare/p2p.mjs`) are **identical** between mobile and desktop. Only the
adapter layer differs:

| Port | Mobile (Expo + react-native-bare-kit) | Desktop (Node/Electron + bare-runtime) |
|---|---|---|
| `IClock` | `mobile/SystemClock` | `desktop/SystemClock` |
| `ILogger` | `mobile/ConsoleLogger` | `desktop/ConsoleLogger` |
| `IFileSystem` | `mobile/ExpoFileSystem` | `desktop/NodeFileSystem` |
| `IKeyValueStore` | `mobile/AsyncStorageKv` | `desktop/NodeKvStore` (atomic JSON-on-disk) |
| `IDatabase` | `mobile/ExpoSqliteDatabase` | `desktop/NodeSqliteDatabase` (built-in `node:sqlite`) |
| `IIdentity` | `mobile/Ed25519Identity` | `desktop/Ed25519Identity` *(re-export, pure JS)* |
| `IEmbeddingService` | `mobile/QvacEmbeddingService` | `desktop/QvacEmbeddingService` *(re-export)* |
| `ILlmService` | `mobile/QvacLlmService` | `desktop/QvacLlmService` *(re-export)* |
| `IMailbox` | `mobile/BareWorkletMailbox` | `desktop/DesktopMailbox` |
| `IPeerNetwork` | `mobile/BareWorkletNetwork` | `desktop/DesktopNetwork` |

The desktop P2P worker (`desktop/DesktopP2pWorker`) spawns the **same**
`bare/p2p.mjs` logic, but via the standalone `bare` binary in a Node
child process. The wire format is the binary framed RPC defined in
`bare/rpc-frame.mjs` — identical on both targets. The desktop entry
shim `bare/p2p.desktop-entry.mjs` synthesises `globalThis.BareKit.IPC`
so `p2p.mjs` runs unchanged.

**IPC transport: loopback TCP.** The Node host opens a server on
`127.0.0.1:<random>`, passes the port to the child via the
`BARE_IPC_PORT` env var, and the entry script connects back via
`bare-net`. We don't use stdio because Windows buffers piped binary
stdout of a child process until exit, which would freeze the
length-prefixed framing. Stdout/stderr of the child are inherited so
log lines from the Bare worker appear inline with the host's.

## Headless peer CLI

The fastest path to a second device:

```powershell
npm install --legacy-peer-deps
npm run desktop:peer            # boots the desktop container + REPL
```

(`npm run build:bare:desktop` is **not** required for dev — Bare
resolves `node_modules` at runtime exactly like Node. The bundle is
reserved for production packaging.)

REPL commands (all input on stdin):

| Command | Effect |
|---|---|
| `publish <text>` | Embed → sign → append to own Hypercore → publish into the shared room |
| `room` | Show the single-room join status |
| `exit` / `quit` | Clean shutdown |

Under the v5 announce-then-pull room the CLI peer acts as a **mirror node**:
it has no interest profile, so it subscribes to announcements and pulls
EVERY announced record — useful for end-to-end testing because it exercises
the sparse-pull path and gives the room a node that holds everything.
Incoming records are verified against the author's Ed25519 public key,
upserted into the SQLite projection, and printed to stdout. To run a second
peer on the same machine, point it at a separate data dir (e.g. PowerShell:
`$env:APPDATA='C:\Users\<you>\AppData\Roaming\ResonanceB'; npm run desktop:peer`).

App-data root resolution (`src/platform/desktop/bootstrap.ts:defaultAppDataDir`):

- Windows: `%APPDATA%/Resonance`
- macOS: `~/Library/Application Support/Resonance`
- Linux: `$XDG_DATA_HOME/Resonance` or `~/.local/share/Resonance`

## Electron shell

```powershell
npm run electron:dev
```

`electron/main.cjs` spawns the headless peer as a child process and
exposes its stdio over a typed `window.resonance` bridge defined in
`electron/preload.cjs`. The placeholder renderer at
`electron/renderer/index.html` is a thin terminal-style UI for the REPL.

### Wiring the real Expo Web UI

The Electron renderer is intentionally a placeholder. To swap in the
real Resonance UI:

1. Add `web` to `app.json` `platforms`.
2. Add deps: `react-native-web`, `react-dom`, `@expo/metro-runtime`.
3. `npx expo export -p web` → produces `dist/`.
4. In `electron/main.cjs`, change `RENDERER_ENTRY` to
   `path.join(__dirname, '..', 'dist', 'index.html')`.
5. Update the renderer's container layer to dispatch through
   `window.resonance` instead of importing platform adapters directly.

This step is deferred because (a) `react-native-web` interactions with
the Bare polyfill in `src/platform/mobile/bootstrap.ts` need validation,
and (b) the `react-native-svg` semantic map and gesture handler must be
tested under web before they can be relied on.

## Known unknowns

- **`@qvac/sdk` under Node**: the desktop QVAC services re-export the
  mobile adapters under the assumption that `@qvac/sdk` resolves its
  Bare worker through the same standalone runtime used by
  `DesktopP2pWorker`. The first `npm run desktop:peer` invocation that
  actually calls `embedder.embed(...)` will validate this assumption.
- **SQLite in Electron**: the desktop adapter uses Node's built-in
  `node:sqlite`, so there is **no native addon to rebuild** for Electron's
  ABI (this replaced an earlier `better-sqlite3` dependency that broke under
  Node 24). The only requirement is a runtime whose Node version ships
  `node:sqlite`.
