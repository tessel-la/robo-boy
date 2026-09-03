import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Official builds must ship no panels: a clean installation obtains them from the official catalog
 * at runtime. Staging a local panel tree leaves its bundles in the frontend output, and from there
 * they are embedded in every installer, so this fails the build before anything is packaged.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const panelsDir = resolve(root, 'dist/panels');

const fail = message => {
  console.error(`[release-panels] ${message}`);
  process.exit(1);
};

let entries;
try {
  entries = await readdir(panelsDir);
} catch {
  console.log('[release-panels] no dist/panels directory; nothing bundled');
  process.exit(0);
}

const unexpected = entries.filter(entry => entry !== 'installed.json');
if (unexpected.length > 0) {
  fail(`release build bundles panel assets: ${unexpected.join(', ')}`);
}

const registry = JSON.parse(await readFile(resolve(panelsDir, 'installed.json'), 'utf8'));
const panels = Array.isArray(registry.panels) ? registry.panels : [];
if (panels.length > 0) {
  fail(`release build bundles panels: ${panels.map(panel => panel.id).join(', ')}`);
}

console.log('[release-panels] no panels bundled; the official catalog supplies them at runtime');
