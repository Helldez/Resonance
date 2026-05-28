/**
 * Web (Electron renderer) bootstrap façade. Metro resolves this in
 * preference to `bootstrap.ts` when the platform is `web`. The renderer
 * does not own any native handle — it constructs a `RemoteContainer`
 * whose ports proxy through the preload `window.resonance` bridge to
 * the desktop container running in Electron main.
 */
export { bootstrapRemote as bootstrapPlatform } from '@platform/remote/RemoteContainer';
export type { PlatformContainer } from '@platform/PlatformContainer';
