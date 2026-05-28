/**
 * The Ed25519 identity implementation is pure JavaScript and depends only
 * on `@noble/ed25519` + `@noble/hashes` + an `IKeyValueStore`. The mobile
 * adapter is therefore 100% reusable on desktop. Re-exported via a
 * relative path so Node resolves it without going through the Metro
 * babel module-resolver alias.
 */
export { Ed25519Identity } from '../mobile/Ed25519Identity';
