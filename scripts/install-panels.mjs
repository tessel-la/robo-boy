import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JSON_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MAX_PANELS = 100;
const MAX_SOURCES = 20;
const PANEL_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,79}$/;
const CAPABILITIES = new Set([
  'ros',
  'storage',
  'network',
  'web-bluetooth',
  'web-usb',
  'web-serial',
  'camera',
  'microphone',
]);

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

const readBytes = async (path, maximumBytes, label = path) => {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new InstallError(`could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (bytes.byteLength > maximumBytes) throw new InstallError(`${label} exceeds ${maximumBytes} bytes.`);
  return bytes;
};

const parseJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new InstallError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readJsonFile = async path => parseJson(await readBytes(path, MAX_JSON_BYTES), path);

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
const validateMetadataUrl = (value, label) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new InstallError(`${label} is not a valid URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new InstallError(`${label} must be an HTTP(S) URL without embedded credentials.`);
  }
  return url;
};
const sha256 = bytes => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
const isIntegrity = value => typeof value === 'string' && /^sha256-[A-Za-z0-9+/]{43}=$/.test(value);
const isPanelId = value => typeof value === 'string' && PANEL_ID.test(value);

const resolveInside = (root, value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new InstallError(`${label} must be a non-empty path.`);
  const path = resolve(root, value);
  const nested = relative(root, path);
  if (nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
    throw new InstallError(`${label} resolves outside ${root}.`);
  }
  return path;
};

const validateSelection = value => {
  if (!value || typeof value !== 'object' || !['all', 'include', 'none'].includes(value.mode)) {
    throw new InstallError('schemaVersion 2 panel configuration needs selection.mode set to all, include, or none.');
  }
  const suppliedIds = value.panelIds;
  if (value.mode === 'include' && (!Array.isArray(suppliedIds) || suppliedIds.length === 0)) {
    throw new InstallError('include selection needs a non-empty panelIds array; use none to install no panels.');
  }
  if (value.mode !== 'include' && suppliedIds !== undefined) {
    throw new InstallError(`${value.mode} selection must not declare panelIds.`);
  }
  const panelIds = new Set();
  for (const id of suppliedIds ?? []) {
    if (!isPanelId(id)) throw new InstallError(`invalid selected panel ID ${String(id)}.`);
    if (panelIds.has(id)) throw new InstallError(`duplicate selected panel ID ${id}.`);
    panelIds.add(id);
  }
  return { mode: value.mode, panelIds };
};

const validateRemoteSource = candidate => {
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
  if (candidate.authorizationEnv !== undefined && !ENVIRONMENT_NAME.test(candidate.authorizationEnv)) {
    throw new InstallError(`${candidate.name} authorizationEnv is invalid.`);
  }
  return {
    type: 'remote',
    name: candidate.name,
    catalogUrl,
    allowedOrigins,
    authenticatedOrigins,
    authorizationEnv: candidate.authorizationEnv,
  };
};

const validateLocalSource = (candidate, label, configPath) => {
  if (!Array.isArray(candidate.repositories) || candidate.repositories.length === 0) {
    throw new InstallError(`${candidate.name} needs a non-empty repositories array.`);
  }
  if (candidate.repositories.length > MAX_PANELS) {
    throw new InstallError(`${candidate.name} exceeds the ${MAX_PANELS}-repository limit.`);
  }
  if (candidate.rootEnv !== undefined && !ENVIRONMENT_NAME.test(candidate.rootEnv)) {
    throw new InstallError(`${candidate.name} rootEnv is invalid.`);
  }
  const configuredRoot = candidate.rootEnv ? process.env[candidate.rootEnv] : undefined;
  const rootValue = configuredRoot || candidate.root;
  if (typeof rootValue !== 'string' || !rootValue.trim()) {
    throw new InstallError(`${candidate.name} needs root or a populated rootEnv.`);
  }
  const root = resolve(dirname(configPath), rootValue);
  const repositories = candidate.repositories.map((repository, index) =>
    resolveInside(root, repository, `${label} repository ${index + 1}`)
  );
  if (new Set(repositories).size !== repositories.length) {
    throw new InstallError(`${candidate.name} contains duplicate local repositories.`);
  }
  return { type: 'local', name: candidate.name, root, repositories };
};

const validateSourceList = (sources, configPath) => {
  if (!Array.isArray(sources) || sources.length === 0) throw new InstallError('at least one panel source is required.');
  if (sources.length > MAX_SOURCES) throw new InstallError(`at most ${MAX_SOURCES} panel sources may be configured.`);
  const names = new Set();
  return sources.map((candidate, index) => {
    const label = `source ${index + 1}`;
    if (!candidate || typeof candidate !== 'object') throw new InstallError(`${label} is invalid.`);
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) throw new InstallError(`${label} needs a name.`);
    if (names.has(candidate.name)) throw new InstallError(`duplicate source name ${candidate.name}.`);
    names.add(candidate.name);
    if (candidate.type === 'remote') return validateRemoteSource(candidate);
    if (candidate.type === 'local') return validateLocalSource(candidate, label, configPath);
    throw new InstallError(`${candidate.name} needs type remote or local.`);
  });
};

const validateLegacyConfig = (value, configPath) => {
  if (!Array.isArray(value.inventories)) {
    throw new InstallError('schemaVersion 1 panel source config must contain an inventories array.');
  }
  if (value.enabledPanels !== undefined && !Array.isArray(value.enabledPanels)) {
    throw new InstallError('enabledPanels must be an array when provided.');
  }
  const panelIds = new Set();
  for (const id of value.enabledPanels ?? []) {
    if (!isPanelId(id)) throw new InstallError(`invalid enabled panel ID ${String(id)}.`);
    if (panelIds.has(id)) throw new InstallError(`duplicate enabled panel ID ${id}.`);
    panelIds.add(id);
  }
  return {
    schemaVersion: 1,
    sources: validateSourceList(
      value.inventories.map(inventory => ({ ...inventory, type: 'remote' })),
      configPath
    ),
    selection: { mode: panelIds.size > 0 ? 'include' : 'all', panelIds },
  };
};

const validateConfig = (value, configPath) => {
  if (!value || typeof value !== 'object') throw new InstallError('panel source config is invalid.');
  if (value.schemaVersion === 1) return validateLegacyConfig(value, configPath);
  if (value.schemaVersion !== 2 || !Array.isArray(value.sources)) {
    throw new InstallError('panel source config must use schemaVersion 2 and contain a sources array.');
  }
  return {
    schemaVersion: 2,
    sources: validateSourceList(value.sources, configPath),
    selection: validateSelection(value.selection),
  };
};

const headersFor = (source, url) => {
  if (!source.authorizationEnv || !source.authenticatedOrigins.has(url.origin)) return {};
  const authorization = process.env[source.authorizationEnv];
  if (!authorization)
    throw new InstallError(`${source.name} requires environment variable ${source.authorizationEnv}.`);
  if (/\r|\n/.test(authorization))
    throw new InstallError(`${source.authorizationEnv} contains an invalid header value.`);
  return { Authorization: authorization };
};

const fetchBytes = async (source, url, maximumBytes, label) => {
  if (!source.allowedOrigins.has(url.origin)) throw new InstallError(`${label} uses unapproved origin ${url.origin}.`);
  let response;
  try {
    response = await fetch(url, { headers: headersFor(source, url), redirect: 'follow' });
  } catch (error) {
    throw new InstallError(`could not download ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const finalUrl = validateUrl(response.url || url.href, undefined, `${label} response URL`);
  if (!source.allowedOrigins.has(finalUrl.origin)) {
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

const fetchJson = async (source, url, label) => parseJson(await fetchBytes(source, url, MAX_JSON_BYTES, label), label);

const validateInventoryEntry = (entry, source) => {
  const label = `${source.name} inventory entry`;
  if (!entry || typeof entry !== 'object' || entry.schemaVersion !== 1) throw new InstallError(`${label} is invalid.`);
  if (!isPanelId(entry.id)) throw new InstallError(`${label} has an invalid ID.`);
  const latest = entry.latest;
  if (!latest || typeof latest !== 'object' || typeof latest.version !== 'string' || !VERSION.test(latest.version)) {
    throw new InstallError(`${entry.id} has an invalid latest version.`);
  }
  const distribution = latest.distribution;
  if (!distribution || distribution.type !== 'javascript-bundle')
    throw new InstallError(`${entry.id} has an unsupported distribution.`);
  if (!isIntegrity(distribution.integrity)) throw new InstallError(`${entry.id} has invalid inventory integrity.`);
  if (typeof distribution.manifestUrl !== 'string' || typeof distribution.bundleUrl !== 'string') {
    throw new InstallError(`${entry.id} is missing release URLs.`);
  }
  return {
    entry,
    latest,
    manifestUrl: validateUrl(distribution.manifestUrl, source.catalogUrl, `${entry.id} manifestUrl`),
    bundleUrl: validateUrl(distribution.bundleUrl, source.catalogUrl, `${entry.id} bundleUrl`),
  };
};

const validateManifestShape = (manifest, label) => {
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) {
    throw new InstallError(`${label} manifest is invalid.`);
  }
  if (!isPanelId(manifest.id)) throw new InstallError(`${label} manifest has an invalid ID.`);
  if (typeof manifest.name !== 'string' || !manifest.name.trim())
    throw new InstallError(`${manifest.id} manifest needs a name.`);
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    throw new InstallError(`${manifest.id} manifest needs a description.`);
  }
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) {
    throw new InstallError(`${manifest.id} manifest has an invalid version.`);
  }
  if (typeof manifest.entryPoint !== 'string' || !manifest.entryPoint.trim()) {
    throw new InstallError(`${manifest.id} manifest needs an entryPoint.`);
  }
  if (!isIntegrity(manifest.integrity)) throw new InstallError(`${manifest.id} manifest has invalid integrity.`);
  if (
    !manifest.compatibility ||
    typeof manifest.compatibility.panelApi !== 'string' ||
    typeof manifest.compatibility.roboboy !== 'string'
  ) {
    throw new InstallError(`${manifest.id} manifest is missing compatibility metadata.`);
  }
  if (!manifest.author || typeof manifest.author.name !== 'string' || !manifest.author.name.trim()) {
    throw new InstallError(`${manifest.id} manifest is missing author metadata.`);
  }
  if (manifest.author.url !== undefined) validateMetadataUrl(manifest.author.url, `${manifest.id} author URL`);
  if (typeof manifest.repository !== 'string')
    throw new InstallError(`${manifest.id} manifest is missing its repository URL.`);
  validateMetadataUrl(manifest.repository, `${manifest.id} repository`);
  if (
    manifest.capabilities !== undefined &&
    (!Array.isArray(manifest.capabilities) ||
      new Set(manifest.capabilities).size !== manifest.capabilities.length ||
      manifest.capabilities.some(capability => !CAPABILITIES.has(capability)))
  ) {
    throw new InstallError(`${manifest.id} manifest declares invalid capabilities.`);
  }
  if (manifest.assets?.length) {
    throw new InstallError(`${manifest.id} declares additional assets; asset installation is not supported yet.`);
  }
  return manifest;
};

const validateRemoteManifest = (manifest, release) => {
  const validated = validateManifestShape(manifest, release.entry.id);
  if (validated.id !== release.entry.id || validated.version !== release.latest.version) {
    throw new InstallError(`${release.entry.id} release manifest identity or version does not match the inventory.`);
  }
  if (validated.integrity !== release.latest.distribution.integrity) {
    throw new InstallError(`${release.entry.id} release manifest integrity does not match the inventory.`);
  }
  return validated;
};

const shouldSelect = (selection, id) => selection.mode === 'all' || selection.panelIds.has(id);

const discoverRemotePanels = async (source, selection) => {
  if (selection.mode === 'none') return [];
  const catalog = await fetchJson(source, source.catalogUrl, `${source.name} catalog`);
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.panels)) {
    throw new InstallError(`${source.name} catalog is invalid.`);
  }
  const releases = [];
  for (const listedPath of catalog.panels) {
    if (typeof listedPath !== 'string')
      throw new InstallError(`${source.name} catalog contains an invalid entry path.`);
    const entryUrl = validateUrl(listedPath, source.catalogUrl, `${source.name} entry URL`);
    const release = validateInventoryEntry(await fetchJson(source, entryUrl, `${source.name} entry`), source);
    if (!shouldSelect(selection, release.entry.id)) continue;
    const manifest = validateRemoteManifest(
      await fetchJson(source, release.manifestUrl, `${release.entry.id} manifest`),
      release
    );
    const bundle = await fetchBytes(source, release.bundleUrl, MAX_BUNDLE_BYTES, `${release.entry.id} bundle`);
    const integrity = sha256(bundle);
    if (integrity !== manifest.integrity)
      throw new InstallError(`${release.entry.id} bundle integrity verification failed.`);
    releases.push({ manifest, bundle, integrity, source: { type: 'remote', name: source.name } });
  }
  return releases;
};

const discoverLocalPanels = async (source, selection) => {
  if (selection.mode === 'none') return [];
  const releases = [];
  for (const repository of source.repositories) {
    const manifestPath = resolveInside(repository, 'roboboy.panel.json', `${source.name} panel manifest`);
    const manifest = validateManifestShape(await readJsonFile(manifestPath), manifestPath);
    if (!shouldSelect(selection, manifest.id)) continue;
    const bundlePath = resolveInside(repository, manifest.entryPoint, `${manifest.id} entryPoint`);
    const bundle = await readBytes(bundlePath, MAX_BUNDLE_BYTES, `${manifest.id} bundle`);
    const integrity = sha256(bundle);
    if (integrity !== manifest.integrity)
      throw new InstallError(`${manifest.id} local bundle integrity does not match its manifest.`);
    releases.push({ manifest, bundle, integrity, source: { type: 'local', name: source.name } });
  }
  return releases;
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

const readInstalledSourceTypes = async output => {
  try {
    const registry = await readJsonFile(resolveInside(output, 'installed.json', 'existing installed panel registry'));
    const resolvedPanels = registry?.installation?.resolvedPanels;
    if (!Array.isArray(resolvedPanels)) return new Map();
    return new Map(
      resolvedPanels
        .filter(
          panel =>
            isPanelId(panel?.id) &&
            typeof panel?.version === 'string' &&
            ['remote', 'local'].includes(panel?.source?.type)
        )
        .map(panel => [`${panel.id}@${panel.version}`, panel.source.type])
    );
  } catch {
    return new Map();
  }
};

const install = async options => {
  const config = validateConfig(await readJsonFile(options.config), options.config);
  const prepared = [];
  const discoveredIds = new Set();

  for (const source of config.sources) {
    const releases =
      source.type === 'remote'
        ? await discoverRemotePanels(source, config.selection)
        : await discoverLocalPanels(source, config.selection);
    for (const release of releases) {
      if (discoveredIds.has(release.manifest.id)) {
        throw new InstallError(`panel ID ${release.manifest.id} is provided by more than one selected source.`);
      }
      discoveredIds.add(release.manifest.id);
      prepared.push(release);
      if (prepared.length > MAX_PANELS) throw new InstallError(`installation exceeds the ${MAX_PANELS}-panel limit.`);
      console.log(
        `[panel-installer] verified ${release.manifest.id}@${release.manifest.version} from ${release.source.type}:${release.source.name}`
      );
    }
  }

  for (const requestedId of config.selection.panelIds) {
    if (!discoveredIds.has(requestedId))
      throw new InstallError(`selected panel ${requestedId} was not found in any source.`);
  }

  if (options.dryRun) {
    console.log(`[panel-installer] dry run verified ${prepared.length} panel${prepared.length === 1 ? '' : 's'}.`);
    return;
  }

  await mkdir(options.output, { recursive: true });
  const installedSourceTypes = await readInstalledSourceTypes(options.output);
  const stagingRoot = resolveInside(options.output, `.install-${randomUUID()}`, 'installation staging directory');
  await mkdir(stagingRoot, { recursive: true });
  const replacedReleases = [];
  let committed = false;
  try {
    const installedPanels = [];
    const resolvedPanels = [];
    for (const release of prepared) {
      const stagedRelease = resolveInside(
        stagingRoot,
        `${release.manifest.id}/${release.manifest.version}`,
        `${release.manifest.id} staged release`
      );
      await mkdir(stagedRelease, { recursive: true });
      await writeFile(resolveInside(stagedRelease, 'index.js', `${release.manifest.id} staged bundle`), release.bundle);
      const installedManifest = {
        ...release.manifest,
        entryPoint: `./${release.manifest.id}/${release.manifest.version}/index.js`,
        integrity: release.integrity,
      };
      installedPanels.push(installedManifest);
      resolvedPanels.push({
        id: release.manifest.id,
        version: release.manifest.version,
        integrity: release.integrity,
        source: release.source,
      });

      const finalRelease = resolveInside(
        options.output,
        `${release.manifest.id}/${release.manifest.version}`,
        `${release.manifest.id} release`
      );
      if (await pathExists(finalRelease)) {
        const existingIntegrity = sha256(
          await readBytes(
            resolveInside(finalRelease, 'index.js', `${release.manifest.id} installed bundle`),
            MAX_BUNDLE_BYTES
          )
        );
        if (existingIntegrity !== release.integrity) {
          const releaseKey = `${release.manifest.id}@${release.manifest.version}`;
          const replacesLocalArtifact =
            release.source.type === 'local' || installedSourceTypes.get(releaseKey) === 'local';
          if (!replacesLocalArtifact) {
            throw new InstallError(`${releaseKey} already exists with different immutable remote bytes.`);
          }
          const backupRelease = resolveInside(
            stagingRoot,
            `.backups/${release.manifest.id}/${release.manifest.version}`,
            `${release.manifest.id} release backup`
          );
          await mkdir(dirname(backupRelease), { recursive: true });
          await rename(finalRelease, backupRelease);
          await rename(stagedRelease, finalRelease);
          replacedReleases.push({ finalRelease, backupRelease });
        }
      } else {
        await mkdir(dirname(finalRelease), { recursive: true });
        await rename(stagedRelease, finalRelease);
      }
      await writeAtomic(
        resolveInside(
          options.output,
          `${release.manifest.id}/roboboy.panel.json`,
          `${release.manifest.id} installed manifest`
        ),
        `${JSON.stringify({ ...installedManifest, installedFrom: release.source }, null, 2)}\n`
      );
    }

    const registry = {
      schemaVersion: 1,
      installation: {
        schemaVersion: 1,
        configSchemaVersion: config.schemaVersion,
        selection: {
          mode: config.selection.mode,
          ...(config.selection.mode === 'include' ? { panelIds: [...config.selection.panelIds] } : {}),
        },
        sources: config.sources.map(source => ({ type: source.type, name: source.name })),
        resolvedPanels,
      },
      panels: installedPanels,
    };
    await writeAtomic(
      resolveInside(options.output, 'installed.json', 'installed panel registry'),
      `${JSON.stringify(registry, null, 2)}\n`
    );
    committed = true;
    console.log(
      `[panel-installer] installed ${installedPanels.length} panel${installedPanels.length === 1 ? '' : 's'} in ${options.output}`
    );
  } catch (error) {
    if (!committed) {
      for (const replacement of replacedReleases.reverse()) {
        await rm(replacement.finalRelease, { recursive: true, force: true });
        await rename(replacement.backupRelease, replacement.finalRelease);
      }
    }
    throw error;
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
