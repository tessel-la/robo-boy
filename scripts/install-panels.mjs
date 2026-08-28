import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JSON_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MAX_PANELS = 100;
const PANEL_ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

class InstallError extends Error {}

const parseArguments = argv => {
  const options = { config: '', output: '', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--config' && value) options.config = resolve(projectRoot, value);
    else if (argument === '--output' && value) options.output = resolve(projectRoot, value);
    else if (argument === '--dry-run') options.dryRun = true;
    else throw new InstallError(`unknown or incomplete argument: ${argument}`);
    if (argument === '--config' || argument === '--output') index += 1;
  }
  if (!options.config) throw new InstallError('--config is required.');
  if (!options.output) throw new InstallError('--output is required.');
  return options;
};

const readJsonFile = async path => {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new InstallError(`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (bytes.byteLength > MAX_JSON_BYTES) throw new InstallError(`${path} exceeds ${MAX_JSON_BYTES} bytes.`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new InstallError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const validateUrl = (value, base, label) => {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new InstallError(`${label} is not a valid URL.`);
  }
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new InstallError(`${label} must use HTTPS.`);
  if (url.username || url.password) throw new InstallError(`${label} must not contain URL credentials.`);
  return url;
};

const normalizeOrigin = (value, label) => validateUrl(value, undefined, label).origin;

const validateConfig = value => {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !Array.isArray(value.inventories)) {
    throw new InstallError('panel source config must use schemaVersion 1 and contain an inventories array.');
  }
  if (value.inventories.length === 0) throw new InstallError('at least one panel inventory is required.');
  if (value.inventories.length > 20) throw new InstallError('at most 20 panel inventories may be configured.');
  if (value.enabledPanels !== undefined && !Array.isArray(value.enabledPanels)) {
    throw new InstallError('enabledPanels must be an array when provided.');
  }

  const names = new Set();
  const inventories = value.inventories.map((candidate, index) => {
    const label = `inventory ${index + 1}`;
    if (!candidate || typeof candidate !== 'object') throw new InstallError(`${label} is invalid.`);
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) throw new InstallError(`${label} needs a name.`);
    if (names.has(candidate.name)) throw new InstallError(`duplicate inventory name ${candidate.name}.`);
    names.add(candidate.name);
    if (typeof candidate.catalogUrl !== 'string') throw new InstallError(`${candidate.name} needs catalogUrl.`);
    const catalogUrl = validateUrl(candidate.catalogUrl, undefined, `${candidate.name} catalogUrl`);
    const allowedOrigins = new Set([catalogUrl.origin]);
    if (candidate.allowedOrigins !== undefined && !Array.isArray(candidate.allowedOrigins)) {
      throw new InstallError(`${candidate.name} allowedOrigins must be an array.`);
    }
    for (const origin of candidate.allowedOrigins ?? []) {
      if (typeof origin !== 'string') throw new InstallError(`${candidate.name} contains an invalid allowed origin.`);
      allowedOrigins.add(normalizeOrigin(origin, `${candidate.name} allowed origin`));
    }
    const authenticatedOrigins = new Set();
    if (candidate.authenticatedOrigins !== undefined && !Array.isArray(candidate.authenticatedOrigins)) {
      throw new InstallError(`${candidate.name} authenticatedOrigins must be an array.`);
    }
    for (const origin of candidate.authenticatedOrigins ?? [catalogUrl.origin]) {
      const normalized = normalizeOrigin(origin, `${candidate.name} authenticated origin`);
      if (!allowedOrigins.has(normalized)) {
        throw new InstallError(`${candidate.name} authenticated origin ${normalized} is not allowed.`);
      }
      authenticatedOrigins.add(normalized);
    }
    if (candidate.authorizationEnv !== undefined && !/^[A-Z][A-Z0-9_]{0,79}$/.test(candidate.authorizationEnv)) {
      throw new InstallError(`${candidate.name} authorizationEnv is invalid.`);
    }
    return {
      name: candidate.name,
      catalogUrl,
      allowedOrigins,
      authenticatedOrigins,
      authorizationEnv: candidate.authorizationEnv,
    };
  });

  const enabledPanels = new Set();
  for (const id of value.enabledPanels ?? []) {
    if (typeof id !== 'string' || !PANEL_ID.test(id)) throw new InstallError(`invalid enabled panel ID ${String(id)}.`);
    if (enabledPanels.has(id)) throw new InstallError(`duplicate enabled panel ID ${id}.`);
    enabledPanels.add(id);
  }
  return { inventories, enabledPanels };
};

const headersFor = (inventory, url) => {
  if (!inventory.authorizationEnv || !inventory.authenticatedOrigins.has(url.origin)) return {};
  const authorization = process.env[inventory.authorizationEnv];
  if (!authorization) throw new InstallError(`${inventory.name} requires environment variable ${inventory.authorizationEnv}.`);
  if (/\r|\n/.test(authorization)) throw new InstallError(`${inventory.authorizationEnv} contains an invalid header value.`);
  return { Authorization: authorization };
};

const fetchBytes = async (inventory, url, maximumBytes, label) => {
  if (!inventory.allowedOrigins.has(url.origin)) throw new InstallError(`${label} uses unapproved origin ${url.origin}.`);
  let response;
  try {
    response = await fetch(url, { headers: headersFor(inventory, url), redirect: 'follow' });
  } catch (error) {
    throw new InstallError(`could not download ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const finalUrl = validateUrl(response.url || url.href, undefined, `${label} response URL`);
  if (!inventory.allowedOrigins.has(finalUrl.origin)) {
    throw new InstallError(`${label} redirected to unapproved origin ${finalUrl.origin}.`);
  }
  if (!response.ok) throw new InstallError(`could not download ${label}: HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new InstallError(`${label} exceeds ${maximumBytes} bytes.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new InstallError(`${label} exceeds ${maximumBytes} bytes.`);
  return bytes;
};

const fetchJson = async (inventory, url, label) => {
  const bytes = await fetchBytes(inventory, url, MAX_JSON_BYTES, label);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new InstallError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const sha256 = bytes => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
const isIntegrity = value => typeof value === 'string' && /^sha256-[A-Za-z0-9+/]{43}=$/.test(value);

const validateInventoryEntry = (entry, inventory) => {
  const label = `${inventory.name} inventory entry`;
  if (!entry || typeof entry !== 'object' || entry.schemaVersion !== 1) throw new InstallError(`${label} is invalid.`);
  if (typeof entry.id !== 'string' || !PANEL_ID.test(entry.id)) throw new InstallError(`${label} has an invalid ID.`);
  const latest = entry.latest;
  if (!latest || typeof latest !== 'object' || typeof latest.version !== 'string' || !VERSION.test(latest.version)) {
    throw new InstallError(`${entry.id} has an invalid latest version.`);
  }
  const distribution = latest.distribution;
  if (!distribution || distribution.type !== 'javascript-bundle') throw new InstallError(`${entry.id} has an unsupported distribution.`);
  if (!isIntegrity(distribution.integrity)) throw new InstallError(`${entry.id} has invalid inventory integrity.`);
  if (typeof distribution.manifestUrl !== 'string' || typeof distribution.bundleUrl !== 'string') {
    throw new InstallError(`${entry.id} is missing release URLs.`);
  }
  return {
    entry,
    latest,
    manifestUrl: validateUrl(distribution.manifestUrl, inventory.catalogUrl, `${entry.id} manifestUrl`),
    bundleUrl: validateUrl(distribution.bundleUrl, inventory.catalogUrl, `${entry.id} bundleUrl`),
  };
};

const validateManifest = (manifest, inventoryRelease) => {
  const { entry, latest } = inventoryRelease;
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) {
    throw new InstallError(`${entry.id} release manifest is invalid.`);
  }
  if (manifest.id !== entry.id || manifest.version !== latest.version) {
    throw new InstallError(`${entry.id} release manifest identity or version does not match the inventory.`);
  }
  if (!isIntegrity(manifest.integrity) || manifest.integrity !== latest.distribution.integrity) {
    throw new InstallError(`${entry.id} release manifest integrity does not match the inventory.`);
  }
  if (!manifest.compatibility || typeof manifest.compatibility.panelApi !== 'string' || typeof manifest.compatibility.roboboy !== 'string') {
    throw new InstallError(`${entry.id} release manifest is missing compatibility metadata.`);
  }
  if (manifest.assets?.length) {
    throw new InstallError(`${entry.id} declares additional assets; remote asset installation is not supported yet.`);
  }
  return manifest;
};

const writeAtomic = async (path, bytes) => {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, path);
};

const pathExists = async path => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const install = async options => {
  const config = validateConfig(await readJsonFile(options.config));
  const discovered = [];
  const discoveredIds = new Set();

  for (const inventory of config.inventories) {
    const catalog = await fetchJson(inventory, inventory.catalogUrl, `${inventory.name} catalog`);
    if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.panels)) {
      throw new InstallError(`${inventory.name} catalog is invalid.`);
    }
    for (const listedPath of catalog.panels) {
      if (typeof listedPath !== 'string') throw new InstallError(`${inventory.name} catalog contains an invalid entry path.`);
      const entryUrl = validateUrl(listedPath, inventory.catalogUrl, `${inventory.name} entry URL`);
      const entry = validateInventoryEntry(await fetchJson(inventory, entryUrl, `${inventory.name} entry`), inventory);
      if (config.enabledPanels.size && !config.enabledPanels.has(entry.entry.id)) continue;
      if (discoveredIds.has(entry.entry.id)) throw new InstallError(`panel ID ${entry.entry.id} is provided by more than one inventory.`);
      discoveredIds.add(entry.entry.id);
      discovered.push({ inventory, ...entry });
      if (discovered.length > MAX_PANELS) throw new InstallError(`installation exceeds the ${MAX_PANELS}-panel limit.`);
    }
  }

  for (const requestedId of config.enabledPanels) {
    if (!discoveredIds.has(requestedId)) throw new InstallError(`enabled panel ${requestedId} was not found in any inventory.`);
  }

  const prepared = [];
  for (const release of discovered) {
    const manifest = validateManifest(
      await fetchJson(release.inventory, release.manifestUrl, `${release.entry.id} manifest`),
      release
    );
    const bundle = await fetchBytes(release.inventory, release.bundleUrl, MAX_BUNDLE_BYTES, `${release.entry.id} bundle`);
    const integrity = sha256(bundle);
    if (integrity !== manifest.integrity) throw new InstallError(`${release.entry.id} bundle integrity verification failed.`);
    prepared.push({ manifest, bundle, integrity, inventory: release.inventory.name });
    console.log(`[panel-installer] verified ${manifest.id}@${manifest.version} from ${release.inventory.name}`);
  }

  if (options.dryRun) {
    console.log(`[panel-installer] dry run verified ${prepared.length} panel${prepared.length === 1 ? '' : 's'}.`);
    return;
  }

  await mkdir(options.output, { recursive: true });
  const stagingRoot = join(options.output, `.install-${randomUUID()}`);
  await mkdir(stagingRoot, { recursive: true });
  try {
    const installedPanels = [];
    for (const release of prepared) {
      const stagedRelease = join(stagingRoot, release.manifest.id, release.manifest.version);
      await mkdir(stagedRelease, { recursive: true });
      await writeFile(join(stagedRelease, 'index.js'), release.bundle);
      const installedManifest = {
        ...release.manifest,
        entryPoint: `./${release.manifest.id}/${release.manifest.version}/index.js`,
        integrity: release.integrity,
      };
      installedPanels.push(installedManifest);

      const finalRelease = join(options.output, release.manifest.id, release.manifest.version);
      if (await pathExists(finalRelease)) {
        const existingIntegrity = sha256(await readFile(join(finalRelease, 'index.js')));
        if (existingIntegrity !== release.integrity) {
          throw new InstallError(`${release.manifest.id}@${release.manifest.version} already exists with different bytes.`);
        }
      } else {
        await mkdir(dirname(finalRelease), { recursive: true });
        await rename(stagedRelease, finalRelease);
      }
      await writeAtomic(
        join(options.output, release.manifest.id, 'roboboy.panel.json'),
        `${JSON.stringify({ ...installedManifest, inventory: release.inventory }, null, 2)}\n`
      );
    }
    await writeAtomic(
      join(options.output, 'installed.json'),
      `${JSON.stringify({ schemaVersion: 1, panels: installedPanels }, null, 2)}\n`
    );
    console.log(`[panel-installer] installed ${installedPanels.length} panel${installedPanels.length === 1 ? '' : 's'} in ${options.output}`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
};

try {
  await install(parseArguments(process.argv.slice(2)));
} catch (error) {
  console.error(`[panel-installer] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
