import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { build } from 'esbuild';

// Bundle the same browser-independent codecs used by import review, without producing a build artifact.
const root = fileURLToPath(new URL('..', import.meta.url));
const result = await build({
  stdin: { contents: "export { readCatalog, checkedRelease } from './src/features/library/catalog';", resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { readCatalog, checkedRelease } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const catalogPath = resolve(root, process.argv[2] || 'library/catalog.json');
const catalog = readCatalog(await readFile(catalogPath, 'utf8'));
for (const item of catalog.items) {
  const file = resolve(dirname(catalogPath), item.url);
  const path = relative(dirname(catalogPath), file);
  if (isAbsolute(path) || path.startsWith('..') || /^[a-z]+:/i.test(item.url)) throw new Error(`Package must be inside the catalog folder: ${item.url}`);
  checkedRelease(await readFile(file, 'utf8'), item);
}
console.log(`Validated ${catalog.items.length} content releases in ${relative(root, catalogPath)}.`);
