# Desktop target — runbook & architecture

> Status: **second-class target** (Android remains the MVP). The desktop
> peer exists primarily so a contributor can run a second Resonance node
> on a development machine and exercise the P2P matching path end-to-end
> without provisioning a second phone.

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
| `IDatabase` | `mobile/ExpoSqliteDatabase` | `desktop/NodeSqliteDatabase` (`better-sqlite3`) |
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
| `publish <text>` | Embed → derive bucket → join swarm → sign → append to own Hypercore |
| `peers` | List known peer Noise keys |
| `buckets` | List buckets currently joined |
| `exit` | Clean shutdown |

Incoming records are verified against the author's Ed25519 public key,
upserted into the SQLite projection, and printed to stdout.

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
- **Native modules in Electron**: `better-sqlite3` ships prebuilds for
  Node ABI, not Electron's. Production packaging will need
  `electron-rebuild` (or use `@journeyapps/sqlcipher`-style prebuilds).
  Not relevant for the headless CLI peer, which runs under plain Node.
