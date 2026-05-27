/**
 * with-foreground-service.js — Expo config plugin that wires an Android
 * foreground service into the prebuilt project.
 *
 * Responsibilities:
 *   1. Add FOREGROUND_SERVICE / FOREGROUND_SERVICE_DATA_SYNC permissions to
 *      AndroidManifest (POST_NOTIFICATIONS is declared in app.json).
 *   2. Add the <service> declaration with foregroundServiceType=dataSync.
 *   3. Copy `ResonanceForegroundService.kt` into the Android source tree at
 *      the correct package path.
 *   4. Copy `strings.xml` resources used by the service into the res tree.
 *   5. Hook MainApplication.onCreate to start the service on app boot.
 *
 * No values are hardcoded at call sites — the package name comes from
 * `config.android.package` and is propagated to both the Kotlin source and
 * the manifest.
 */

const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('expo/config-plugins');

const SOURCE_DIR = path.join(__dirname, 'android-foreground-service-src');
const SERVICE_CLASS_NAME = 'ResonanceForegroundService';
const SERVICE_KOTLIN_FILE = `${SERVICE_CLASS_NAME}.kt`;
const STRINGS_FILE = 'strings.xml';
const STRINGS_RES_PATH = path.join('app', 'src', 'main', 'res', 'values', 'resonance_fg_strings.xml');

function withForegroundServiceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    // cfg.modResults is wrapped as { manifest: { ... } } — the inner
    // `manifest` node is where xmlns:android is declared and where
    // <uses-permission> elements must be siblings of <application>.
    const root = cfg.modResults.manifest;
    const pkg = cfg.android?.package;
    if (typeof pkg !== 'string' || pkg.length === 0) {
      throw new Error('with-foreground-service: android.package is required');
    }

    addPermission(root, 'android.permission.FOREGROUND_SERVICE');
    addPermission(root, 'android.permission.FOREGROUND_SERVICE_DATA_SYNC');

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.service = application.service ?? [];
    const fqcn = `${pkg}.${SERVICE_CLASS_NAME}`;
    const already = application.service.find(
      (s) => s.$ && s.$['android:name'] === fqcn,
    );
    if (!already) {
      application.service.push({
        $: {
          'android:name': fqcn,
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }
    return cfg;
  });
}

function addPermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] ?? [];
  const exists = manifest['uses-permission'].some(
    (p) => p.$ && p.$['android:name'] === name,
  );
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function withForegroundServiceKotlin(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (typeof pkg !== 'string' || pkg.length === 0) {
        throw new Error('with-foreground-service: android.package is required');
      }
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const pkgDirs = pkg.split('.');
      const kotlinDir = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        ...pkgDirs,
      );
      await fs.promises.mkdir(kotlinDir, { recursive: true });
      const src = await fs.promises.readFile(
        path.join(SOURCE_DIR, SERVICE_KOTLIN_FILE),
        'utf8',
      );
      // Rewrite the `package` line to match android.package so this plugin
      // is reusable across projects with different package names.
      const rewritten = src.replace(
        /^package\s+[A-Za-z0-9_.]+/m,
        `package ${pkg}`,
      );
      await fs.promises.writeFile(
        path.join(kotlinDir, SERVICE_KOTLIN_FILE),
        rewritten,
        'utf8',
      );

      const stringsSrc = await fs.promises.readFile(
        path.join(SOURCE_DIR, STRINGS_FILE),
        'utf8',
      );
      const stringsDest = path.join(androidRoot, STRINGS_RES_PATH);
      await fs.promises.mkdir(path.dirname(stringsDest), { recursive: true });
      await fs.promises.writeFile(stringsDest, stringsSrc, 'utf8');

      return cfg;
    },
  ]);
}

function withForegroundServiceBoot(config) {
  return withMainApplication(config, (cfg) => {
    const pkg = cfg.android?.package;
    if (typeof pkg !== 'string' || pkg.length === 0) {
      throw new Error('with-foreground-service: android.package is required');
    }
    const importLine = `import ${pkg}.${SERVICE_CLASS_NAME}`;
    const startCall = `${SERVICE_CLASS_NAME}.start(this)`;

    let src = cfg.modResults.contents;

    if (!src.includes(importLine)) {
      src = src.replace(
        /^(package\s+[A-Za-z0-9_.]+)/m,
        `$1\n\n${importLine}`,
      );
    }

    if (!src.includes(startCall)) {
      // Insert into onCreate just after the super call. Match both the
      // Kotlin-with-body form and the single-expression form Expo emits.
      src = src.replace(
        /(override\s+fun\s+onCreate\(\)\s*\{[^}]*?super\.onCreate\(\)\s*\n)/,
        `$1    ${startCall}\n`,
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withForegroundService(config) {
  config = withForegroundServiceManifest(config);
  config = withForegroundServiceKotlin(config);
  config = withForegroundServiceBoot(config);
  return config;
};
