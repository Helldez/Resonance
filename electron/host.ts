/**
 * Electron main-process host for Resonance.
 *
 * Responsibilities:
 *   1. Bootstrap the desktop container (`@platform/desktop/bootstrap`) in
 *      main, so all native modules (`better-sqlite3`, `bare-runtime`,
 *      `@qvac/sdk`) live exactly here.
 *   2. Expose every port method the renderer needs over the
 *      `container/call` IPC channel.
 *   3. Forward push events (network records, presence, peer noise keys,
 *      model load progress, LLM streaming chunks) to all open
 *      BrowserWindows via `webContents.send`.
 *   4. Open a single BrowserWindow that loads the Expo Web export
 *      (`dist/index.html`).
 */

import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import type { IpcMainInvokeEvent } from 'electron';
import { join, resolve, delimiter as PATH_DELIM } from 'node:path';
import { existsSync } from 'node:fs';
import { bootstrapDesktop, defaultAppDataDir } from '@platform/desktop/bootstrap';
import type { DesktopContainer } from '@platform/desktop/bootstrap';
import { DesktopConfig } from '@core/config/DesktopConfig';
import type { ModelProgressUpdate } from '@qvac/sdk';
import type { PeerId, SignedRecord } from '@core/domain/types';

const REPO_ROOT = resolve(__dirname, '..');

// The QVAC native addon (`@qvac/embed-llamacpp`) on Windows is compiled
// with MinGW-w64 and dynamically links `libwinpthread-1.dll`,
// `libstdc++-6.dll`, `libgcc_s_seh-1.dll`. These ship with Git for
// Windows under `Git/mingw64/bin`. A bash session normally has that
// directory in PATH so the addon loads; an Electron process launched
// from PowerShell or `cmd /k` does not, and the addon fails with
// "The specified module could not be found" (Windows STATUS_DLL_NOT_FOUND).
// We probe a few known locations and prepend the first that contains the
// pthread DLL so every child process the host spawns inherits a working
// search path.
function ensureMinGwDllsOnPath(): void {
  if (process.platform !== 'win32') {
    return;
  }
  const candidates = [
    'C:\\Program Files\\Git\\mingw64\\bin',
    'C:\\Program Files (x86)\\Git\\mingw64\\bin',
    'C:\\msys64\\mingw64\\bin',
  ];
  const probe = 'libwinpthread-1.dll';
  for (const dir of candidates) {
    if (existsSync(join(dir, probe))) {
      const current = process.env.PATH ?? '';
      if (!current.split(PATH_DELIM).includes(dir)) {
        process.env.PATH = `${dir}${PATH_DELIM}${current}`;
        console.log(`[host] prepended MinGW DLL dir to PATH: ${dir}`);
      }
      return;
    }
  }
  console.warn('[host] could not locate MinGW DLLs — QVAC addon may fail to load');
}
ensureMinGwDllsOnPath();
const WEB_DIST_DIR = join(REPO_ROOT, 'dist');
const WEB_DIST_ENTRY = join(WEB_DIST_DIR, process.env.RESONANCE_RENDERER ?? 'index.html');
const BARE_ENTRY = join(REPO_ROOT, DesktopConfig.bareDesktopEntry);
const APP_SCHEME = 'resonance';

// Privileged custom scheme — registered before app.whenReady so it
// behaves like `https://` for cookies / fetch / CORS. We then map
// `resonance://app/<path>` requests to files inside `dist/`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let containerPromise: Promise<DesktopContainer> | null = null;

function getContainer(): Promise<DesktopContainer> {
  if (containerPromise === null) {
    const appDataDir = app.isReady()
      ? app.getPath('userData')
      : defaultAppDataDir(app.getPath('home'), process.platform);
    containerPromise = bootstrapDesktop({
      appDataDir,
      bareEntryPath: BARE_ENTRY,
    }).then((c) => {
      attachEventForwarders(c);
      return c;
    });
  }
  return containerPromise;
}

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function attachEventForwarders(c: DesktopContainer): void {
  c.network.onRecord((record: SignedRecord) => {
    broadcast('network/record', record);
  });
  c.network.onPeerPresence((peer: PeerId, present: boolean) => {
    broadcast('network/presence', { peerId: peer, present });
  });
}

type Handler = (c: DesktopContainer, args: ReadonlyArray<unknown>) => Promise<unknown> | unknown;

const handlers: Record<string, Record<string, Handler>> = {
  container: {
    info: (c) => ({ self: c.self }),
  },
  database: {
    query: (c, a) => c.database.query(a[0] as string, (a[1] as ReadonlyArray<unknown>) ?? []),
    exec: (c, a) => c.database.exec(a[0] as string, (a[1] as ReadonlyArray<unknown>) ?? []),
  },
  keyValue: {
    get: (c, a) => c.keyValue.get(a[0] as string),
    set: (c, a) => c.keyValue.set(a[0] as string, a[1] as string),
    delete: (c, a) => c.keyValue.delete(a[0] as string),
  },
  fileSystem: {
    exists: (c, a) => c.fileSystem.exists(a[0] as string),
    makeDir: (c, a) => c.fileSystem.makeDir(a[0] as string),
    remove: (c, a) => c.fileSystem.remove(a[0] as string),
    size: (c, a) => c.fileSystem.size(a[0] as string),
  },
  identity: {
    loadOrCreate: (c) => c.identity.loadOrCreate(),
    sign: (c, a) => c.identity.sign(a[0] as Uint8Array),
    verify: (c, a) =>
      c.identity.verify(a[0] as Uint8Array, a[1] as Uint8Array, a[2] as PeerId),
  },
  embedder: {
    initialize: (c) => c.embedder.initialize(),
    shutdown: (c) => c.embedder.shutdown(),
    isLoaded: (c) => c.embedderConcrete.isLoaded,
    load: (c) =>
      c.embedderConcrete.load((p: ModelProgressUpdate) => broadcast('embedder/progress', p)),
    embed: (c, a) => c.embedder.embed(a[0] as string),
  },
  llm: {
    initialize: (c) => c.llm.initialize(),
    shutdown: (c) => c.llm.shutdown(),
    isLoaded: (c) => c.llmConcrete.isLoaded,
    load: (c) =>
      c.llmConcrete.load((p: ModelProgressUpdate) => broadcast('llm/progress', p)),
    complete: (c, a) =>
      c.llm.complete(a[0] as string, a[1] as Parameters<typeof c.llm.complete>[1]),
    completeStream: async (c, a) => {
      const streamId = a[0] as string;
      const prompt = a[1] as string;
      const options = a[2] as Parameters<typeof c.llm.completeStream>[1];
      await c.llm.completeStream(prompt, options, (chunk) => {
        broadcast('llm/chunk', { streamId, chunk });
      });
    },
  },
  network: {
    joinRoom: (c) => c.network.joinRoom(),
    rescan: (c) => c.network.rescan(),
  },
  mailbox: {
    append: (c, a) => c.mailbox.append(a[0] as SignedRecord),
  },
};

ipcMain.handle(
  'container/call',
  async (_event: IpcMainInvokeEvent, port: string, method: string, args: ReadonlyArray<unknown>) => {
    const group = handlers[port];
    if (group === undefined) {
      throw new Error(`unknown port "${port}"`);
    }
    const fn = group[method];
    if (fn === undefined) {
      throw new Error(`unknown method "${port}.${method}"`);
    }
    const c = await getContainer();
    return await fn(c, args);
  },
);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: '#0e0f12',
    webPreferences: {
      preload: process.env.RESONANCE_NO_PRELOAD === '1' ? undefined : join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (existsSync(WEB_DIST_ENTRY)) {
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[host] did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedUrl}`);
    });
    win.webContents.on('preload-error', (_event, preloadPath, err) => {
      console.error(`[host] preload-error path=${preloadPath} err=${err.stack ?? err.message}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[host] renderer gone:', details);
    });
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message}  (${sourceId}:${line})`);
    });
    win.loadURL(`${APP_SCHEME}://app/`);
    // DevTools can be opened manually with Ctrl+Shift+I; opening it
    // detached programmatically has crashed the renderer on some
    // Windows builds, so we leave it off by default.
  } else {
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<!doctype html><html><body style="background:#0e0f12;color:#e8eaee;font-family:sans-serif;padding:24px"><h2>Resonance — web bundle missing</h2><p>Run <code>npm run web:export</code> first to produce <code>dist/index.html</code>, then relaunch.</p></body></html>`,
        ),
    );
  }
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
}

// Some Windows GPU drivers (especially under remote desktop / WSLg) crash
// Chromium's GPU process, which in turn tears down the renderer with exit
// code 143. Disabling hardware acceleration is the cheapest stable fix
// for a local-first developer app and incurs negligible perceived cost.
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  // Serve the Expo Web export under `resonance://app/`. With a clean
  // scheme + host the URL path is just `/`, so Expo Router's
  // pathname-based matching resolves the index route correctly. Under
  // `file://` the pathname would be the absolute on-disk path
  // (`/C:/.../dist/index.html`), which produces "Unmatched Route".
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === '' || pathname === '/') {
      pathname = '/index.html';
    }
    // Expo Router static export emits `/<route>.html` for each route.
    // If the requested pathname has no extension and isn't `/`, try the
    // `.html` sibling so client-side anchor navigation just works.
    const hasExt = pathname.includes('.');
    const trimmed = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const target = hasExt ? pathname : trimmed + '.html';
    const relative = target.startsWith('/') ? target.slice(1) : target;
    const abs = join(WEB_DIST_DIR, relative);
    return net.fetch(pathToFileURL(abs).toString());
  });

  // Kick off the container boot in parallel so the swarm starts joining
  // peers while the window is still loading the web bundle.
  void getContainer().catch((err) => {
    console.error('[host] container bootstrap failed:', err);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (containerPromise === null) {
    return;
  }
  try {
    const c = await containerPromise;
    await c.network.shutdown();
    await c.mailbox.shutdown();
    await c.p2p.shutdown();
    await c.embedder.shutdown();
    await c.llm.shutdown();
    await c.database.shutdown();
  } catch (err) {
    console.warn('[host] shutdown error:', err);
  }
});
