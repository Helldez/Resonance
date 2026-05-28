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

import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { bootstrapDesktop, defaultAppDataDir } from '@platform/desktop/bootstrap';
import type { DesktopContainer } from '@platform/desktop/bootstrap';
import { DesktopConfig } from '@core/config/DesktopConfig';
import type { ModelProgressUpdate } from '@qvac/sdk';
import type { BucketId, PeerId, SignedRecord } from '@core/domain/types';

const REPO_ROOT = resolve(__dirname, '..');
const WEB_DIST_ENTRY = join(REPO_ROOT, 'dist', 'index.html');
const BARE_ENTRY = join(REPO_ROOT, DesktopConfig.bareDesktopEntry);

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
  c.network.onPeerPresence((peer: PeerId, bucket: BucketId, present: boolean) => {
    broadcast('network/presence', { peerId: peer, bucket, present });
  });
  c.p2p.onPeerNoise((peerId: string, noiseKey: string) => {
    broadcast('p2p/peerNoise', { peerId, noiseKey });
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
    joinBucket: (c, a) => c.network.joinBucket(a[0] as BucketId),
    leaveBucket: (c, a) => c.network.leaveBucket(a[0] as BucketId),
    joinedBuckets: (c) => [...c.network.joinedBuckets],
  },
  mailbox: {
    append: (c, a) => c.mailbox.append(a[0] as SignedRecord),
  },
  p2p: {
    localNoiseKey: (c) => c.p2p.localNoiseKey,
    joinPeer: (c, a) => c.p2p.joinPeer(a[0] as string),
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
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (existsSync(WEB_DIST_ENTRY)) {
    win.loadFile(WEB_DIST_ENTRY);
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

app.whenReady().then(() => {
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
