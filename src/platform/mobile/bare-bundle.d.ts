/**
 * `bare-pack` emits a single .bundle.mjs file whose default export is the
 * bundle payload as a UTF-8 string. Declare its shape so consumers can
 * import it under strict TypeScript.
 */
declare module '*.bundle.mjs' {
  const bundle: string;
  export default bundle;
}
