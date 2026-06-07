// Diagnostic: pipe main stdout, poll up to 90s for the tab bar, then
// native screenshot + DOM dump of wherever the app ended up.
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, '.ui-shots');
fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
  args: [path.join(ROOT, 'electron/main.cjs')],
  cwd: ROOT,
  timeout: 60_000,
});
const proc = app.process();
proc.stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`));
proc.stderr?.on('data', (d) => process.stdout.write(`[main!] ${d}`));
const page = await app.firstWindow();

let ready = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(3000);
  const found = await page.evaluate(() => document.querySelector('[aria-label="Home"]') !== null);
  if (found) {
    ready = true;
    console.log(`>>> Home tab visible after ~${(i + 1) * 3}s`);
    break;
  }
}
if (!ready) {
  console.log('>>> Home tab NOT found after 90s');
}

const b64 = await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  const img = await win.webContents.capturePage();
  return img.toPNG().toString('base64');
});
fs.writeFileSync(path.join(OUT, 'diag.png'), Buffer.from(b64, 'base64'));
console.log('>>> screenshot saved');
console.log('--- innerText (400) ---');
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 400));
await app.close();
