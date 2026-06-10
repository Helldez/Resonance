// Resonance Expo config.
//
// Static configuration lives in app.json. This thin wrapper lets the release
// pipeline make the **git tag the single source of truth for the version**:
// when CI sets the env vars below (versionName from the tag, versionCode from a
// monotonic commit count), they win; otherwise app.json's values are used, so
// local development and non-release builds are unaffected.
//
// Expo passes the parsed app.json in as `config`, so this only overrides the
// two version fields and leaves everything else untouched.
module.exports = ({ config }) => {
  const versionName = process.env.RESONANCE_VERSION_NAME;
  const versionCode = process.env.RESONANCE_VERSION_CODE;

  return {
    ...config,
    ...(versionName ? { version: versionName } : {}),
    android: {
      ...config.android,
      ...(versionCode ? { versionCode: Number.parseInt(versionCode, 10) } : {}),
    },
  };
};
