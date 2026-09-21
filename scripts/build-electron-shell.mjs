#!/usr/bin/env node
/**
 * Compiles the Electron shell's own sources.
 *
 * The main process and the preload script are the only parts of Robo-Boy that run outside a
 * browser, so they are built apart from the renderer: esbuild is already present as a Vite
 * dependency, and the shell is two files with no bundling to speak of.
 *
 * The preload script is emitted as CommonJS with a `.cjs` extension. Electron loads preload
 * scripts as CommonJS whatever the package type says, and the app declares `"type": "module"`.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'dist-electron', 'shell');

// Electron ships its own Node; bundling either would produce a second copy that cannot talk to
// the running process.
const external = ['electron'];

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, 'electron', 'main.ts')],
  outfile: path.join(outDir, 'main.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external,
  sourcemap: true,
});

await build({
  entryPoints: [path.join(projectRoot, 'electron', 'preload.ts')],
  outfile: path.join(outDir, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external,
  sourcemap: true,
});

console.log(`[electron-shell] wrote ${path.relative(projectRoot, outDir)}/{main.js,preload.cjs}`);
