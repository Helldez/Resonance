/**
 * Electron main launcher. Registers the `tsx` CJS hook so we can require
 * TypeScript modules (with the project's `@core/*` aliases) directly
 * from the main process, then delegates to `electron/host.ts` for the
 * full container + IPC wiring.
 *
 * Kept as a tiny CommonJS bootstrap so Electron — which expects a
 * synchronously-loadable `main` entry — can launch without a build
 * step in development.
 */

'use strict';

const path = require('node:path');

// Register tsx's CJS loader so subsequent require() calls can resolve
// .ts files and apply the tsconfig path aliases.
require('tsx/cjs/api').register();

// Hand off to the typed host. Path is relative to this file.
require(path.join(__dirname, 'host.ts'));
