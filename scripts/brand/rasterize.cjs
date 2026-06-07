/**
 * Rasterize the Resonance brand mark into every PNG the app needs
 * (Expo icons, Android splash logos, Electron window icon, favicon).
 *
 * Uses the Electron binary already in devDependencies as a headless
 * renderer — no extra image deps. Run with:
 *
 *   npx electron scripts/brand/rasterize.cjs
 *
 * Source of truth for the geometry is assets/brand/resonance-mark.svg;
 * the MARK constant below mirrors it.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');

/** The mark in its native 240×240 box (mirrors assets/brand/resonance-mark.svg). */
const MARK = `
  <defs>
    <linearGradient id="res-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9D85FF"/>
      <stop offset="1" stop-color="#6B4DFF"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#res-g)" stroke-width="28" stroke-linecap="round">
    <path d="M99.29 42.73A80 80 0 0 1 199.7 126.97"/>
    <path d="M140.71 197.27A80 80 0 0 1 40.3 113.03"/>
  </g>
  <circle cx="120" cy="120" r="28" fill="url(#res-g)"/>`;

/**
 * Build a square SVG document of `canvas` px with the mark scaled to
 * `markPx` and centered. `bg` is `null` (transparent), a color string
 * (full-bleed square), or `{ color, radius }` (rounded rect).
 */
function svgDoc(canvas, markPx, bg) {
  const s = markPx / 240;
  const off = (canvas - markPx) / 2;
  let bgRect = '';
  if (typeof bg === 'string') {
    bgRect = `<rect width="${canvas}" height="${canvas}" fill="${bg}"/>`;
  } else if (bg !== null) {
    bgRect = `<rect width="${canvas}" height="${canvas}" rx="${bg.radius}" fill="${bg.color}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">${bgRect}<g transform="translate(${off} ${off}) scale(${s})">${MARK}</g></svg>`;
}

/** target list: [outPath, canvasPx, markPx, bg] */
const TARGETS = [
  // Expo app icon: full-bleed black square (stores apply their own masks).
  ['assets/icon.png', 1024, 640, '#000000'],
  // Adaptive-icon foreground: transparent, mark inside the 66/108 safe zone.
  ['assets/adaptive-icon.png', 1024, 683, null],
  // Splash logo: transparent, generous padding for the Android 12 circle mask.
  ['assets/splash-icon.png', 1024, 560, null],
  // Web favicon.
  ['assets/favicon.png', 256, 224, null],
  // Electron window/taskbar icon: rounded square, Windows 11 style.
  ['electron/icon.png', 256, 158, { color: '#000000', radius: 56 }],
  // Android splash logos (288dp base, matching the generated res layout).
  ['android/app/src/main/res/drawable-mdpi/splashscreen_logo.png', 288, 158, null],
  ['android/app/src/main/res/drawable-hdpi/splashscreen_logo.png', 432, 236, null],
  ['android/app/src/main/res/drawable-xhdpi/splashscreen_logo.png', 576, 315, null],
  ['android/app/src/main/res/drawable-xxhdpi/splashscreen_logo.png', 864, 473, null],
  ['android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png', 1152, 630, null],
];

app.disableHardwareAcceleration();

/**
 * Render an SVG string to a PNG data URL inside the page via <canvas>.
 * Avoids capturePage(), whose output is clamped to display size/DPI.
 */
async function renderOne(win, outPath, canvas, markPx, bg) {
  const svg = svgDoc(canvas, markPx, bg);
  const dataUrl = await win.webContents.executeJavaScript(`
    (async () => {
      const svg = atob(${JSON.stringify(Buffer.from(svg).toString('base64'))});
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement('canvas');
      c.width = ${canvas}; c.height = ${canvas};
      c.getContext('2d').drawImage(img, 0, 0, ${canvas}, ${canvas});
      URL.revokeObjectURL(url);
      return c.toDataURL('image/png');
    })()
  `);
  const abs = join(ROOT, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${outPath} (${canvas}x${canvas})`);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('about:blank');
    for (const [out, canvas, mark, bg] of TARGETS) {
      await renderOne(win, out, canvas, mark, bg);
    }
    win.destroy();
    console.log('done');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
