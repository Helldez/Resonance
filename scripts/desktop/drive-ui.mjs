/**
 * One-shot UI driver for the Electron app (agent/CI use): launches the
 * app via Playwright's _electron, walks the compose flow (Home → FAB →
 * compose → type → Post → Home) and drops screenshots + a DOM audit of
 * the tappable controls at every step. No xvfb needed on Windows.
 *
 *   node scripts/desktop/drive-ui.mjs [outDir]
 */
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2] ?? path.join(ROOT, '.ui-shots');
fs.mkdirSync(OUT, { recursive: true });

const electronBin = path.join(
  ROOT,
  'node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

function log(...args) {
  console.log('[drive]', ...args);
}

const app = await electron.launch({
  executablePath: electronBin,
  args: [path.join(ROOT, 'electron/main.cjs')],
  cwd: ROOT,
  timeout: 60_000,
});
const page = await app.firstWindow();
log('window url:', page.url());

// Native capture via Electron: CDP's Page.captureScreenshot hangs when the
// window is occluded with hardware acceleration disabled (the compositor
// stops producing frames); webContents.capturePage does not.
async function shot(name) {
  const f = path.join(OUT, `${name}.png`);
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const img = await win.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  log('screenshot:', f);
}

/** List visible tappable controls (role=button/tab) with their labels. */
async function audit(label) {
  const controls = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="button"], [role="tab"], button, textarea, input')];
    return els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') ?? '',
          label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '',
          disabled: el.getAttribute('aria-disabled') === 'true',
          rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        };
      });
  });
  log(`controls @ ${label}:`);
  for (const c of controls) {
    log(`  [${c.tag}${c.role ? `/${c.role}` : ''}] "${c.label}"${c.disabled ? ' (disabled)' : ''} @ ${c.rect}`);
  }
}

/** DOM click by aria-label (coordinate-free — reliable across overlays). */
async function clickLabel(label) {
  const r = await page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`);
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  }, label);
  log('click', JSON.stringify(label), '→', r);
  return r === 'OK';
}

// 1. Wait for the app shell (boot can take a few seconds: container + model).
log('waiting for the tab bar…');
await page.waitForSelector('[aria-label="Home"]', { timeout: 120_000 });
await page.waitForTimeout(1500);
await shot('01-home');
await audit('home');

// 2. Open compose via the FAB.
if (!(await clickLabel('Write a post'))) {
  throw new Error('Compose FAB not found');
}
await page.waitForTimeout(1200);
await shot('02-compose-empty');
await audit('compose');

// 3. Type a post.
const textarea = await page.waitForSelector('textarea', { timeout: 10_000 });
await textarea.click();
await page.keyboard.type('Test from the new desktop UI — compose flow check.', { delay: 10 });
await page.waitForTimeout(500);
await shot('03-compose-typed');

// 4. Publish.
if (!(await clickLabel('Post'))) {
  throw new Error('Post button not found');
}
log('published, waiting for the feed…');
await page.waitForTimeout(3500);
await shot('04-after-post');
await audit('after-post');

await app.close();
log('done.');
