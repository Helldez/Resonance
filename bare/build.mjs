#!/usr/bin/env node
/**
 * Bundle the Bare P2P worker into a single self-contained file using
 * bare-pack. The output is loaded at runtime by the React Native side via
 * `react-native-bare-kit` Worklet.start('/p2p.bundle', source).
 *
 * Output: bare/p2p.bundle.mjs (excluded from VCS).
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = resolve(__dirname, 'p2p.mjs')
const out = resolve(__dirname, 'p2p.bundle.mjs')

const args = [
  '-o', out,
  '-f', 'bundle.mjs',
  '--linked',
  entry,
]

const cwd = resolve(__dirname, '..')
const bin = process.platform === 'win32' ? 'bare-pack.cmd' : 'bare-pack'

const child = spawn(bin, args, {
  cwd,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code) => {
  if (code === 0) {
    console.log(`Bare P2P worker bundled to ${out}`)
  }
  process.exit(code ?? 1)
})
