/**
 * The framed-RPC client only depends on the `buffer` package (an exact
 * Buffer polyfill that ships a passthrough to Node's built-in `Buffer`
 * under Node) and on a minimal `{ on('data'), write }` Duplex-like. Both
 * conditions are satisfied on Node and on `react-native-bare-kit`, so we
 * reuse the mobile implementation verbatim.
 */
export { FramedRpcClient } from '../mobile/FramedRpcClient';
export type { EventHandler } from '../mobile/FramedRpcClient';
