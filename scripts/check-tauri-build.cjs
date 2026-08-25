const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const distDir = process.env.ROBOBOY_DIST_DIR
  ? path.resolve(projectRoot, process.env.ROBOBOY_DIST_DIR)
  : path.join(projectRoot, 'dist');
const indexPath = path.join(distDir, 'index.html');

const fail = message => {
  console.error(`[tauri-build-check] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(indexPath)) {
  fail('dist/index.html is missing.');
}

const html = fs.readFileSync(indexPath, 'utf8');
const externalScripts = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*>/gi)];

if (externalScripts.length !== 1) {
  fail(`expected one external entry script, found ${externalScripts.length}.`);
}

const [entryTag, attributes, entrySource] = externalScripts[0];
if (!/\btype=["']module["']/i.test(attributes) && !/\btype=["']module["']/i.test(entryTag)) {
  fail('the frontend entry is not type="module"; packaged builds would differ from Tauri dev mode.');
}

const resolveAsset = source => path.resolve(distDir, source.replace(/^[./]+/, ''));
const entryPath = resolveAsset(entrySource);
if (!entryPath.startsWith(`${distDir}${path.sep}`) || !fs.existsSync(entryPath)) {
  fail(`entry asset is missing: ${entrySource}`);
}

const entryCode = fs.readFileSync(entryPath, 'utf8');
const lazyChunks = [...entryCode.matchAll(/import\(["']([^"']+)["']\)/g)].map(match => match[1]);
for (const chunkSource of lazyChunks) {
  const chunkPath = path.resolve(path.dirname(entryPath), chunkSource);
  if (!chunkPath.startsWith(`${distDir}${path.sep}`) || !fs.existsSync(chunkPath)) {
    fail(`lazy chunk referenced by the entry is missing: ${chunkSource}`);
  }
}

console.log(
  `[tauri-build-check] module entry and ${lazyChunks.length} lazy chunk${lazyChunks.length === 1 ? '' : 's'} verified.`
);
