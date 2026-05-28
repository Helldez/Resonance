#!/usr/bin/env node
/**
 * Bundle the Bare P2P worker for the current desktop host (win32 / darwin
 * / linux). Output: `bare/p2p.desktop.bundle.mjs`. This is the desktop
 * counterpart of `bare/build.mjs` (which targets Android only).
 *
 * The entry point is `bare/p2p.desktop-entry.mjs`, which shims
 * `globalThis.BareKit` so `p2p.mjs` (unmodified) can run under the
 * standalone `bare` binary.
 *
 * By default we bundle for the build machine's platform/arch. Pass
 * `--host <platform-arch>` (repeatable) to override — useful when
 * cross-bundling for CI artifacts.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = resolve(__dirname, 'p2p.desktop-entry.mjs')
const out = resolve(__dirname, 'p2p.desktop.bundle.mjs')

const hostsFromCli = []
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--host' && i + 1 < process.argv.length) {
    hostsFromCli.push(process.argv[i + 1])
    i++
  }
}

const defaultHost = `${process.platform}-${process.arch}`
const hosts = hostsFromCli.length > 0 ? hostsFromCli : [defaultHost]

const args = ['-o', out, '-f', 'bundle.mjs', '--linked']
for (const h of hosts) {
  args.push('--host', h)
}
args.push(entry)

const cwd = resolve(__dirname, '..')
const bin = process.platform === 'win32' ? 'bare-pack.cmd' : 'bare-pack'

console.log(`Bundling Bare desktop worker for: ${hosts.join(', ')}`)

const child = spawn(bin, args, {
  cwd,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code) => {
  if (code === 0) {
    console.log(`Bare desktop worker bundled to ${out}`)
  }
  process.exit(code ?? 1)
})
