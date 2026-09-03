import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Vite serves ROBOBOY_PUBLIC_DIR when set, and a panel build stages a different tree; writing to
// the served directory keeps the sandbox document reachable instead of 404ing there.
const publicDir = resolve(root, process.env.ROBOBOY_PUBLIC_DIR || 'public');
const outputPath = resolve(publicDir, 'panel-sandbox.html');

const bundleToText = async (entry, format) => {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    format,
    target: 'es2022',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
};

const bootstrapSource = await bundleToText('src/panels/sandboxEntry.ts', 'iife');

// The document shell owns the sandbox CSP, so it stays beside the runtime it wraps rather than
// being duplicated here; bundling the module lets this build step reuse that single definition.
const temporaryModule = join(tmpdir(), `roboboy-panel-sandbox-${process.pid}.mjs`);
await writeFile(temporaryModule, await bundleToText('src/panels/sandboxRuntime.ts', 'esm'));
try {
  const { createPanelSandboxDocument } = await import(pathToFileURL(temporaryModule).href);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${createPanelSandboxDocument(bootstrapSource)}\n`);
} finally {
  await rm(temporaryModule, { force: true });
}

console.log(`[panel-sandbox] wrote ${relative(root, outputPath)}`);
