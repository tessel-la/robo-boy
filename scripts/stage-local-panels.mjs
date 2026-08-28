import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fail = message => {
  console.error(`[panel-stage] ${message}`);
  process.exit(1);
};

const readJson = async path => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const assertInside = (path, root, label) => {
  const nested = relative(root, path);
  if (nested === '' || (!nested.startsWith(`..${sep}`) && nested !== '..' && !isAbsolute(nested))) return;
  fail(`${label} resolves outside ${root}.`);
};

const sri = bytes => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;

const parseArguments = argv => {
  const options = {
    inventory: resolve(projectRoot, '../robo-boy-panel-inventory'),
    output: resolve(projectRoot, '.panel-stage/public'),
    sourceRoot: resolve(projectRoot, '..'),
    panelIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--inventory' && value) options.inventory = resolve(projectRoot, value);
    else if (argument === '--output' && value) options.output = resolve(projectRoot, value);
    else if (argument === '--source-root' && value) options.sourceRoot = resolve(projectRoot, value);
    else if (argument === '--panel' && value) options.panelIds.push(value);
    else if (argument === '--panels' && value) options.panelIds.push(...value.split(',').map(id => id.trim()).filter(Boolean));
    else fail(`unknown or incomplete argument: ${argument}`);
    if (['--inventory', '--output', '--source-root', '--panel', '--panels'].includes(argument)) index += 1;
  }

  if (options.panelIds.length === 0 && process.env.ROBOBOY_PANEL_IDS) {
    options.panelIds.push(...process.env.ROBOBOY_PANEL_IDS.split(',').map(id => id.trim()).filter(Boolean));
  }
  return options;
};

const findLocalPanelRepositories = async sourceRoot => {
  const repositories = new Map();
  const candidates = await readdir(sourceRoot, { withFileTypes: true });
  for (const candidate of candidates) {
    if (!candidate.isDirectory()) continue;
    const repository = join(sourceRoot, candidate.name);
    const manifestPath = join(repository, 'roboboy.panel.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (typeof manifest.id === 'string') repositories.set(manifest.id, { repository, manifest, manifestPath });
    } catch {
      // Sibling directories without a panel manifest are unrelated workspace projects.
    }
  }
  return repositories;
};

const options = parseArguments(process.argv.slice(2));
const catalogPath = join(options.inventory, 'catalog.json');
const catalog = await readJson(catalogPath);
if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.panels)) {
  fail(`${catalogPath} is not a panel inventory catalog.`);
}

const inventoryEntries = [];
for (const listedPath of catalog.panels) {
  if (typeof listedPath !== 'string') fail('the inventory catalog contains a non-string panel path.');
  const entryPath = resolve(options.inventory, listedPath);
  assertInside(entryPath, options.inventory, listedPath);
  inventoryEntries.push(await readJson(entryPath));
}

const requestedIds = new Set(options.panelIds);
const selectedEntries = requestedIds.size
  ? inventoryEntries.filter(entry => requestedIds.has(entry.id))
  : inventoryEntries;
for (const requestedId of requestedIds) {
  if (!selectedEntries.some(entry => entry.id === requestedId)) fail(`panel ${requestedId} is not in the inventory.`);
}

const localRepositories = await findLocalPanelRepositories(options.sourceRoot);
const publicSource = join(projectRoot, 'public');
await rm(options.output, { recursive: true, force: true });
await mkdir(dirname(options.output), { recursive: true });
await cp(publicSource, options.output, { recursive: true });

const panelsOutput = join(options.output, 'panels');
await rm(panelsOutput, { recursive: true, force: true });
await mkdir(panelsOutput, { recursive: true });

const installedPanels = [];
for (const inventoryEntry of selectedEntries) {
  const local = localRepositories.get(inventoryEntry.id);
  if (!local) fail(`no sibling panel repository with ID ${inventoryEntry.id} was found below ${options.sourceRoot}.`);

  const manifest = local.manifest;
  const latest = inventoryEntry.latest;
  if (manifest.schemaVersion !== 1 || manifest.id !== inventoryEntry.id) fail(`${local.manifestPath} has invalid identity metadata.`);
  if (!latest || manifest.version !== latest.version) {
    fail(`${inventoryEntry.id} inventory version ${latest?.version ?? '<missing>'} does not match local version ${manifest.version}.`);
  }
  if (typeof manifest.entryPoint !== 'string') fail(`${local.manifestPath} does not declare an entry point.`);

  const sourceBundle = resolve(local.repository, manifest.entryPoint);
  assertInside(sourceBundle, local.repository, `${inventoryEntry.id} entry point`);
  let bundle;
  try {
    bundle = await readFile(sourceBundle);
  } catch (error) {
    fail(`could not read ${sourceBundle}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const integrity = sri(bundle);
  if (manifest.integrity !== integrity) fail(`${inventoryEntry.id} manifest integrity does not match its local bundle.`);
  if (latest.distribution?.integrity !== integrity) fail(`${inventoryEntry.id} inventory integrity does not match its local bundle.`);

  const releaseDirectory = join(panelsOutput, manifest.id, manifest.version);
  await mkdir(releaseDirectory, { recursive: true });
  await writeFile(join(releaseDirectory, 'index.js'), bundle);

  const installedManifest = {
    ...manifest,
    entryPoint: `./${manifest.id}/${manifest.version}/index.js`,
    integrity,
  };
  installedPanels.push(installedManifest);
  await writeFile(join(panelsOutput, manifest.id, 'roboboy.panel.json'), `${JSON.stringify(installedManifest, null, 2)}\n`);
  console.log(`[panel-stage] staged ${manifest.id}@${manifest.version}`);
}

await writeFile(
  join(panelsOutput, 'installed.json'),
  `${JSON.stringify({ schemaVersion: 1, panels: installedPanels }, null, 2)}\n`
);
console.log(`[panel-stage] wrote ${installedPanels.length} panel${installedPanels.length === 1 ? '' : 's'} to ${options.output}`);
