#!/usr/bin/env node
/**
 * Post-process the Expo Web export so it can be loaded by Electron via
 * `file://`:
 *
 *   1. `dist/index.html` is rewritten so `src="/_expo/..."` and
 *      `href="/_expo/..."` become relative paths (`./_expo/...`).
 *      Under `file://`, an absolute leading slash resolves to the drive
 *      root, not to the bundle directory.
 *
 *   2. The JS bundle under `dist/_expo/static/js/web/index-*.js` is
 *      scanned for `import.meta` references (zustand's `persist`
 *      middleware contains `import.meta.env.MODE` baked in by its
 *      author). Metro emits the bundle as a classic, non-module
 *      `<script>`, where `import.meta` is a syntax error. We replace
 *      each occurrence with an inert object literal so the runtime
 *      reads `MODE === undefined` and disables debug paths.
 *
 * No regex per project rules — both passes walk the string.
 */

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(here), '..', '..')
const distDir = resolve(repoRoot, 'dist')
const htmlPath = join(distDir, 'index.html')

await patchHtml()
await patchJsBundles()

async function patchHtml() {
  const original = await fs.readFile(htmlPath, 'utf8')
  let patched = rewriteAbsoluteAssetUrls(original)
  patched = injectGlobalErrorTrap(patched)
  if (patched === original) {
    console.log('[patch-web-html] HTML already patched:', htmlPath)
    return
  }
  await fs.writeFile(htmlPath, patched, 'utf8')
  console.log('[patch-web-html] HTML patched:', htmlPath)
}

/**
 * Insert a `<script>` at the top of `<head>` that surfaces uncaught
 * renderer errors via console.error before the React tree mounts. This
 * makes failures visible in the host log even when the bundle crashes
 * during top-level evaluation.
 */
function injectGlobalErrorTrap(html) {
  const marker = '<!-- resonance-error-trap -->'
  if (html.indexOf(marker) >= 0) {
    return html
  }
  const headOpen = '<head>'
  const idx = html.indexOf(headOpen)
  if (idx < 0) {
    return html
  }
  const trap =
    headOpen +
    '\n' +
    marker +
    "\n<script>(function(){function f(o,where){try{console.error('[renderer-trap]',where,o&&(o.stack||o.message||String(o)));}catch(_){}}window.addEventListener('error',function(e){f(e.error||e.message,'error');});window.addEventListener('unhandledrejection',function(e){f(e.reason,'unhandledrejection');});})();</script>\n"
  return html.slice(0, idx) + trap + html.slice(idx + headOpen.length)
}

async function patchJsBundles() {
  const jsDir = join(distDir, '_expo', 'static', 'js', 'web')
  let entries
  try {
    entries = await fs.readdir(jsDir)
  } catch {
    console.log('[patch-web-html] no JS bundle directory at', jsDir)
    return
  }
  for (const name of entries) {
    if (!name.endsWith('.js')) {
      continue
    }
    const full = join(jsDir, name)
    const original = await fs.readFile(full, 'utf8')
    const patched = neutraliseImportMeta(original)
    if (patched === original) {
      continue
    }
    await fs.writeFile(full, patched, 'utf8')
    console.log('[patch-web-html] neutralised import.meta in', full)
  }
}

function rewriteAbsoluteAssetUrls(html) {
  const attrs = ['src="', "src='", 'href="', "href='"]
  let out = ''
  let i = 0
  while (i < html.length) {
    let matchedAttr = null
    for (const a of attrs) {
      if (html.startsWith(a, i)) {
        matchedAttr = a
        break
      }
    }
    if (matchedAttr === null) {
      out += html[i]
      i++
      continue
    }
    out += matchedAttr
    i += matchedAttr.length
    if (
      i < html.length &&
      html[i] === '/' &&
      (i + 1 >= html.length || html[i + 1] !== '/')
    ) {
      out += '.'
    }
  }
  return out
}

/**
 * Replace every occurrence of `import.meta` (token-level, only when
 * preceded by a non-identifier character) with `({})` so any
 * downstream `import.meta.env?.MODE` simply evaluates to `undefined`.
 */
function neutraliseImportMeta(src) {
  const needle = 'import.meta'
  const replacement = '({})'
  if (src.indexOf(needle) < 0) {
    return src
  }
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src.startsWith(needle, i) && !isIdentifierChar(src.charCodeAt(i - 1))) {
      out += replacement
      i += needle.length
      continue
    }
    out += src[i]
    i++
  }
  return out
}

function isIdentifierChar(code) {
  if (Number.isNaN(code)) {
    return false
  }
  return (
    (code >= 0x30 && code <= 0x39) /* 0-9 */ ||
    (code >= 0x41 && code <= 0x5a) /* A-Z */ ||
    (code >= 0x61 && code <= 0x7a) /* a-z */ ||
    code === 0x5f /* _ */ ||
    code === 0x24 /* $ */
  )
}
