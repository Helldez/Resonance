/**
 * Native (Android) bootstrap façade. Metro resolves this on the
 * `android` / `ios` / default targets; the corresponding `.web.ts`
 * sibling is preferred on the Expo Web target (Electron renderer).
 *
 * Keeping a single import path (`@platform/bootstrap`) in the UI layer
 * means screens stay platform-agnostic and the only difference between
 * targets is which adapter set the container is wired from.
 */
export { bootstrapMobile as bootstrapPlatform } from '@platform/mobile/bootstrap';
export type { PlatformContainer } from '@platform/PlatformContainer';
