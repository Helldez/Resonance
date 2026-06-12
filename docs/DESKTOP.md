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
| `IMailbox` | `shared/P2pMailbox` (both targets) | (same) |
| `IPeerNetwork` | `shared/P2pNetwork` (both targets) | (same) |

The P2P worker adapter is shared too (`shared/P2pWorker`, with the
channel injected via `desktop/SubprocessTransport`): it spawns the **same**
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

Under the v6 announce-then-pull room the CLI peer acts as a **mirror node**:
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

### Windows gotcha: `@qvac/embed-llamacpp` needs OpenSSL 3 DLLs

The win32-x64 prebuild of `@qvac/embed-llamacpp` (0.16.x) links against
`libcrypto-3-x64.dll` / `libssl-3-x64.dll`, which are not Windows system
libraries. If they are not resolvable, the QVAC worker dies before IPC with
exit code `0xC0000409` and `Addon.load: The specified module could not be
found` — the P2P worker still boots, so the failure surfaces only on the
first `embed()` call. Workaround until the prebuild bundles them: copy the
two DLLs (Git for Windows ships compatible ones under
`C:\Program Files\Git\mingw64\bin\`) into
`node_modules\bare-runtime-win32-x64\bin\` (next to `bare.exe`). Note that
`npm install` wipes the copy.

## Electron shell

```powershell
npm run app:dev      # web:export + launch Electron in one step
# or, if dist/ is already built:
npm run electron:dev
```

The desktop app runs the **real Resonance UI** — the Expo Web export, not a
placeholder. `electron/main.cjs` registers `tsx` and delegates to
`electron/host.ts`, which:

1. Bootstraps the desktop container (`@platform/desktop/bootstrap`) **in the
   main process**, so every native module (`bare-runtime`, `@qvac/sdk`,
   `node:sqlite`) lives there.
2. Exposes each port method to the renderer over the `container/call` IPC
   channel (`electron/preload.cjs` is the contextIsolated bridge), and
   forwards push events (records, announcements, presence, model progress,
   LLM stream chunks) to the window via `webContents.send`.
3. Serves the Expo Web export (`dist/index.html`) under a privileged
   `resonance://app/` custom scheme and opens a single `BrowserWindow` on it.
   Under `file://` Expo Router would see the absolute on-disk path and report
   "Unmatched Route", so the custom scheme keeps the pathname at `/`.

`npm run web:export` produces `dist/` (it also runs
`scripts/desktop/patch-web-html.mjs`). If `dist/index.html` is missing the
window shows a "web bundle missing — run `npm run web:export`" placeholder
instead of crashing.

## UI smoke driver (Playwright)

`scripts/desktop/drive-ui.mjs` is a one-shot driver for agent/CI use: it
launches the Electron app via Playwright's `_electron`, walks the compose
flow (Home → FAB → compose → type → Post → Home) and drops screenshots plus
a DOM audit of the tappable controls at every step into `.ui-shots/`
(gitignored). No xvfb needed on Windows.

```powershell
node scripts/desktop/drive-ui.mjs [outDir]
```

Related fix: the desktop renderer used to crash on first paint because
screens rendered before the store hydration finished; the bootstrap gate is
now hydration-safe (the splash stays up until stores are hydrated), which is
also what makes this driver deterministic.

## Known unknowns

- **`@qvac/sdk` under Node**: the desktop QVAC services re-export the
  mobile adapters under the assumption that `@qvac/sdk` resolves its
  Bare worker through the same standalone runtime used by
  the shared `P2pWorker`. **Validated**: a `npm run desktop:peer` →
  `publish <text>` run loads the EmbeddingGemma model and returns a 768-dim
  embedding (`embedding.embed dim=768`), then signs and appends the record,
  so the embed path works end-to-end under Node on win32-x64.
- **SQLite in Electron**: the desktop adapter uses Node's built-in
  `node:sqlite`, so there is **no native addon to rebuild** for Electron's
  ABI (this replaced an earlier `better-sqlite3` dependency that broke under
  Node 24). The only requirement is a runtime whose Node version ships
  `node:sqlite`.
