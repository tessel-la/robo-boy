import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Follow build inputs, not package.json's broader development/optional dependency list. */
export async function createThirdPartyNotices(moduleIds) {
  const packages = new Map();
  for (const id of moduleIds) {
    const filename = id.split('?')[0].replaceAll('\0', '');
    if (!filename.includes('node_modules/')) continue;
    let directory = path.dirname(path.resolve(filename));
    while (directory !== path.dirname(directory)) {
      let manifest;
      try {
        manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (manifest?.name && manifest.version) {
        packages.set(`${manifest.name}@${manifest.version}`, { directory, manifest });
        break;
      }
      directory = path.dirname(directory);
    }
  }
  const sections = [
    'Robo-Boy — licenses and third-party notices',
    await readFile(path.join(root, 'LICENSE'), 'utf8'),
    await readFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
  ];
  for (const [name, { directory, manifest }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name))
      .map(entry => entry.name)
      .sort();
    // Some packages publish their grant only in the README. Preserve that original text too.
    if (!files.length) {
      for (const entry of entries.filter(entry => entry.isFile() && /^readme([._-]|$)/i.test(entry.name))) {
        const readme = await readFile(path.join(directory, entry.name), 'utf8');
        if (/^#+\s+licen[cs]e\s*$/im.test(readme) && manifest.license) files.push(entry.name);
      }
    }
    if (!files.length) throw new Error(`No license text found for bundled dependency ${name}.`);
    sections.push(`\n=== ${name} (${manifest.license ?? 'see license text'}) ===`);
    for (const file of files) sections.push(`${file}\n${await readFile(path.join(directory, file), 'utf8')}`);
  }
  return sections.join('\n\n') + '\n';
}

/** Workers are separate Rollup builds; merge their inputs into the app's one notice file. */
export function thirdPartyNoticesPlugins() {
  const workerModules = new Set();
  const moduleIds = bundle =>
    Object.values(bundle).flatMap(chunk => (chunk.type === 'chunk' ? Object.keys(chunk.modules) : []));
  return {
    app: {
      name: 'third-party-notices',
      buildStart() {
        workerModules.clear();
      },
      async generateBundle(_options, bundle) {
        this.emitFile({
          type: 'asset',
          fileName: 'licenses.txt',
          source: await createThirdPartyNotices([...moduleIds(bundle), ...workerModules]),
        });
      },
    },
    worker: {
      name: 'worker-notice-inputs',
      generateBundle(_options, bundle) {
        for (const id of moduleIds(bundle)) workerModules.add(id);
      },
    },
  };
}
