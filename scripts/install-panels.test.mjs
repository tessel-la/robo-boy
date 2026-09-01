import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { applyPanelInstallationPreview, previewPanelInstallation } from './install-panels.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installerPath = join(projectRoot, 'scripts/install-panels.mjs');
const integrity = bytes => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;

const panelFixture = (id, version, origin, prefix) => {
  const bundle = Buffer.from(`export default { apiVersion: '2.0.0', id: '${id}', activate() {} };\n`);
  const digest = integrity(bundle);
  const manifest = {
    schemaVersion: 1,
    id,
    name: id,
    description: `${id} test panel`,
    version,
    entryPoint: './dist/index.js',
    integrity: digest,
    compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
    capabilities: ['storage'],
    author: { name: 'Test Author' },
    repository: `https://example.com/${id}`,
  };
  const entry = {
    schemaVersion: 1,
    id,
    name: id,
    latest: {
      version,
      compatibility: manifest.compatibility,
      capabilities: manifest.capabilities,
      distribution: {
        type: 'javascript-bundle',
        manifestUrl: `${origin}/${prefix}/roboboy.panel.json`,
        bundleUrl: `${origin}/${prefix}/index.js`,
        entryPoint: 'index.js',
        integrity: digest,
      },
    },
  };
  return { bundle, digest, entry, manifest };
};

const startFixtureServer = async handler => {
  const server = createServer(handler);
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) => server.close(error => (error ? rejectClose(error) : resolveClose()))),
  };
};

const sendJson = (response, value) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(value));
};

test('installs public and authenticated private inventories into one registry', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-'));
  let server;
  try {
    const routes = new Map();
    server = await startFixtureServer((request, response) => {
      if (request.url?.startsWith('/private/') && request.headers.authorization !== 'Bearer private-test-token') {
        response.writeHead(401).end();
        return;
      }
      const route = routes.get(request.url ?? '');
      if (!route) {
        response.writeHead(404).end();
        return;
      }
      if (Buffer.isBuffer(route)) response.end(route);
      else sendJson(response, route);
    });
    const publicPanel = panelFixture('com.example.public', '1.0.0', server.origin, 'public/release');
    const privatePanel = panelFixture('com.company.private', '2.1.0', server.origin, 'private/release');
    routes.set('/public/catalog.json', { schemaVersion: 1, panels: ['./entry.json'] });
    routes.set('/public/entry.json', publicPanel.entry);
    routes.set('/public/release/roboboy.panel.json', publicPanel.manifest);
    routes.set('/public/release/index.js', publicPanel.bundle);
    routes.set('/private/catalog.json', { schemaVersion: 1, panels: ['./entry.json'] });
    routes.set('/private/entry.json', privatePanel.entry);
    routes.set('/private/release/roboboy.panel.json', privatePanel.manifest);
    routes.set('/private/release/index.js', privatePanel.bundle);

    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [
          { type: 'remote', name: 'public', catalogUrl: `${server.origin}/public/catalog.json` },
          {
            type: 'remote',
            name: 'private',
            catalogUrl: `${server.origin}/private/catalog.json`,
            authorizationEnv: 'ROBOBOY_PANEL_SOURCE_PRIVATE_AUTHORIZATION',
          },
        ],
        selection: { mode: 'all' },
      })
    );

    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output], {
      env: { ...process.env, ROBOBOY_PANEL_SOURCE_PRIVATE_AUTHORIZATION: 'Bearer private-test-token' },
    });
    const registry = JSON.parse(await readFile(join(output, 'installed.json'), 'utf8'));
    assert.deepEqual(
      registry.panels.map(panel => `${panel.id}@${panel.version}`),
      ['com.example.public@1.0.0', 'com.company.private@2.1.0']
    );
    assert.equal(
      await readFile(join(output, 'com.company.private/2.1.0/index.js'), 'utf8'),
      privatePanel.bundle.toString('utf8')
    );
  } finally {
    await server?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('does not replace the installed registry when integrity verification fails', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-failure-'));
  let server;
  try {
    const routes = new Map();
    server = await startFixtureServer((request, response) => {
      const route = routes.get(request.url ?? '');
      if (!route) return response.writeHead(404).end();
      if (Buffer.isBuffer(route)) response.end(route);
      else sendJson(response, route);
    });
    const panel = panelFixture('com.example.drifted', '1.0.0', server.origin, 'release');
    routes.set('/catalog.json', { schemaVersion: 1, panels: ['./entry.json'] });
    routes.set('/entry.json', panel.entry);
    routes.set('/release/roboboy.panel.json', panel.manifest);
    routes.set('/release/index.js', Buffer.from('different bundle bytes'));

    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    const previousRegistry = '{"schemaVersion":1,"panels":[]}\n';
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'installed.json'), previousRegistry);
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'test', catalogUrl: `${server.origin}/catalog.json` }],
        selection: { mode: 'all' },
      })
    );

    await assert.rejects(execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]));
    assert.equal(await readFile(join(output, 'installed.json'), 'utf8'), previousRegistry);
  } finally {
    await server?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('schemaVersion 2 installs an explicit remote subset and records reproducible provenance', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-selection-'));
  let server;
  try {
    const routes = new Map();
    server = await startFixtureServer((request, response) => {
      const route = routes.get(request.url ?? '');
      if (!route) return response.writeHead(404).end();
      if (Buffer.isBuffer(route)) response.end(route);
      else sendJson(response, route);
    });
    const selected = panelFixture('com.example.selected', '1.0.0', server.origin, 'selected/release');
    const skipped = panelFixture('com.example.skipped', '1.0.0', server.origin, 'skipped/release');
    routes.set('/catalog.json', { schemaVersion: 1, panels: ['./selected.json', './skipped.json'] });
    routes.set('/selected.json', selected.entry);
    routes.set('/skipped.json', skipped.entry);
    routes.set('/selected/release/roboboy.panel.json', selected.manifest);
    routes.set('/selected/release/index.js', selected.bundle);

    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: `${server.origin}/catalog.json` }],
        selection: { mode: 'include', panelIds: ['com.example.selected'] },
      })
    );

    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]);
    const registry = JSON.parse(await readFile(join(output, 'installed.json'), 'utf8'));
    assert.deepEqual(
      registry.panels.map(panel => panel.id),
      ['com.example.selected']
    );
    assert.deepEqual(registry.installation, {
      schemaVersion: 1,
      configSchemaVersion: 2,
      selection: { mode: 'include', panelIds: ['com.example.selected'] },
      sources: [{ type: 'remote', name: 'official' }],
      resolvedPanels: [
        {
          id: 'com.example.selected',
          version: '1.0.0',
          integrity: selected.digest,
          source: { type: 'remote', name: 'official' },
        },
      ],
    });
  } finally {
    await server?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('schemaVersion 2 none selection performs an explicit empty installation without contacting sources', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-none-'));
  try {
    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'offline', catalogUrl: 'https://unreachable.invalid/catalog.json' }],
        selection: { mode: 'none' },
      })
    );

    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]);
    const registry = JSON.parse(await readFile(join(output, 'installed.json'), 'utf8'));
    assert.deepEqual(registry.panels, []);
    assert.equal(registry.installation.selection.mode, 'none');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('installs remote and local panels together from one desired-state configuration', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-mixed-'));
  let server;
  try {
    const routes = new Map();
    server = await startFixtureServer((request, response) => {
      const route = routes.get(request.url ?? '');
      if (!route) return response.writeHead(404).end();
      if (Buffer.isBuffer(route)) response.end(route);
      else sendJson(response, route);
    });
    const remote = panelFixture('com.example.remote', '1.0.0', server.origin, 'remote/release');
    routes.set('/catalog.json', { schemaVersion: 1, panels: ['./remote.json'] });
    routes.set('/remote.json', remote.entry);
    routes.set('/remote/release/roboboy.panel.json', remote.manifest);
    routes.set('/remote/release/index.js', remote.bundle);

    const localRepository = join(temporaryRoot, 'local-panel');
    const local = panelFixture('com.example.local', '0.1.0-dev.1', server.origin, 'unused');
    await mkdir(join(localRepository, 'dist'), { recursive: true });
    await writeFile(join(localRepository, 'roboboy.panel.json'), JSON.stringify(local.manifest));
    await writeFile(join(localRepository, 'dist/index.js'), local.bundle);

    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [
          { type: 'remote', name: 'official', catalogUrl: `${server.origin}/catalog.json` },
          { type: 'local', name: 'workspace', root: '.', repositories: ['./local-panel'] },
        ],
        selection: { mode: 'all' },
      })
    );

    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]);
    const registry = JSON.parse(await readFile(join(output, 'installed.json'), 'utf8'));
    assert.deepEqual(
      registry.panels.map(panel => `${panel.id}@${panel.version}`),
      ['com.example.remote@1.0.0', 'com.example.local@0.1.0-dev.1']
    );
    assert.deepEqual(
      registry.installation.resolvedPanels.map(panel => panel.source.type),
      ['remote', 'local']
    );
  } finally {
    await server?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('replaces same-version local development bytes while retaining exact provenance', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-local-rebuild-'));
  try {
    const localRepository = join(temporaryRoot, 'local-panel');
    const initial = panelFixture('com.example.local-rebuild', '0.1.0-dev', 'https://example.com', 'unused');
    await mkdir(join(localRepository, 'dist'), { recursive: true });
    await writeFile(join(localRepository, 'roboboy.panel.json'), JSON.stringify(initial.manifest));
    await writeFile(join(localRepository, 'dist/index.js'), initial.bundle);
    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [{ type: 'local', name: 'workspace', root: '.', repositories: ['./local-panel'] }],
        selection: { mode: 'all' },
      })
    );
    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]);

    const rebuiltBundle = Buffer.from(
      "export default { apiVersion: '2.0.0', id: 'com.example.local-rebuild', activate() { return {}; } };\n"
    );
    const rebuiltIntegrity = integrity(rebuiltBundle);
    await writeFile(
      join(localRepository, 'roboboy.panel.json'),
      JSON.stringify({ ...initial.manifest, integrity: rebuiltIntegrity })
    );
    await writeFile(join(localRepository, 'dist/index.js'), rebuiltBundle);
    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]);

    assert.equal(
      await readFile(join(output, 'com.example.local-rebuild/0.1.0-dev/index.js'), 'utf8'),
      rebuiltBundle.toString('utf8')
    );
    const registry = JSON.parse(await readFile(join(output, 'installed.json'), 'utf8'));
    assert.equal(registry.panels[0].integrity, rebuiltIntegrity);
    assert.deepEqual(registry.installation.resolvedPanels[0].source, { type: 'local', name: 'workspace' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects changed bytes for an already installed immutable remote version', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-remote-mutation-'));
  let server;
  try {
    const routes = new Map();
    server = await startFixtureServer((request, response) => {
      const route = routes.get(request.url ?? '');
      if (!route) return response.writeHead(404).end();
      if (Buffer.isBuffer(route)) response.end(route);
      else sendJson(response, route);
    });
    const initial = panelFixture('com.example.immutable', '1.0.0', server.origin, 'release');
    routes.set('/catalog.json', { schemaVersion: 1, panels: ['./entry.json'] });
    routes.set('/entry.json', initial.entry);
    routes.set('/release/roboboy.panel.json', initial.manifest);
    routes.set('/release/index.js', initial.bundle);
    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: `${server.origin}/catalog.json` }],
        selection: { mode: 'all' },
      })
    );
    await execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]);
    const previousRegistry = await readFile(join(output, 'installed.json'), 'utf8');

    const changed = panelFixture('com.example.immutable', '1.0.0', server.origin, 'changed-release');
    changed.bundle = Buffer.from(`${changed.bundle.toString('utf8')}// mutation\n`);
    changed.digest = integrity(changed.bundle);
    changed.manifest.integrity = changed.digest;
    changed.entry.latest.distribution.integrity = changed.digest;
    changed.entry.latest.distribution.manifestUrl = `${server.origin}/release/roboboy.panel.json`;
    changed.entry.latest.distribution.bundleUrl = `${server.origin}/release/index.js`;
    routes.set('/entry.json', changed.entry);
    routes.set('/release/roboboy.panel.json', changed.manifest);
    routes.set('/release/index.js', changed.bundle);

    await assert.rejects(execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', output]));
    assert.equal(await readFile(join(output, 'installed.json'), 'utf8'), previousRegistry);
    assert.equal(
      await readFile(join(output, 'com.example.immutable/1.0.0/index.js'), 'utf8'),
      initial.bundle.toString('utf8')
    );
  } finally {
    await server?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects ambiguous schemaVersion 2 include selections', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-invalid-selection-'));
  try {
    const configPath = join(temporaryRoot, 'sources.json');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: 'https://example.com/catalog.json' }],
        selection: { mode: 'include', panelIds: [] },
      })
    );

    await assert.rejects(
      execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', join(temporaryRoot, 'out')]),
      error => error.stderr.includes('use none to install no panels')
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects removed schemaVersion 1 source configuration', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-v1-config-'));
  try {
    const configPath = join(temporaryRoot, 'sources.json');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        inventories: [{ name: 'legacy', catalogUrl: 'https://example.com/catalog.json' }],
      })
    );

    await assert.rejects(
      execFileAsync(process.execPath, [installerPath, '--config', configPath, '--output', join(temporaryRoot, 'out')]),
      error => error.stderr.includes('must use schemaVersion 2')
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects attempts to reuse privileged environment variables as panel source inputs', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-env-scope-'));
  try {
    const output = join(temporaryRoot, 'out');
    await assert.rejects(
      previewPanelInstallation({
        config: join(temporaryRoot, 'sources.json'),
        configValue: {
          schemaVersion: 2,
          sources: [
            {
              type: 'remote',
              name: 'unsafe',
              catalogUrl: 'https://example.com/catalog.json',
              authorizationEnv: 'ROBOBOY_PANEL_MANAGER_TOKEN',
            },
          ],
          selection: { mode: 'none' },
        },
        output,
      }),
      /dedicated panel-source credential/
    );
    await assert.rejects(
      previewPanelInstallation({
        config: join(temporaryRoot, 'sources.json'),
        configValue: {
          schemaVersion: 2,
          sources: [
            {
              type: 'local',
              name: 'unsafe',
              rootEnv: 'ROBOBOY_PANEL_MANAGER_TOKEN',
              repositories: ['panel'],
            },
          ],
          selection: { mode: 'none' },
        },
        output,
      }),
      /dedicated panel workspace root/
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('previews exact add and remove changes without mutating the active registry', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-preview-'));
  try {
    const localRepository = join(temporaryRoot, 'local-panel');
    const next = panelFixture('com.example.next', '2.0.0', 'https://example.com', 'unused');
    await mkdir(join(localRepository, 'dist'), { recursive: true });
    await writeFile(join(localRepository, 'roboboy.panel.json'), JSON.stringify(next.manifest));
    await writeFile(join(localRepository, 'dist/index.js'), next.bundle);
    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    const config = {
      schemaVersion: 2,
      sources: [{ type: 'local', name: 'workspace', root: '.', repositories: ['./local-panel'] }],
      selection: { mode: 'all' },
    };
    await mkdir(output, { recursive: true });
    const previousRegistry = JSON.stringify({
      schemaVersion: 1,
      panels: [
        {
          ...next.manifest,
          id: 'com.example.previous',
          name: 'Previous',
          entryPoint: './com.example.previous/1.0.0/index.js',
          version: '1.0.0',
        },
      ],
    });
    await writeFile(join(output, 'installed.json'), previousRegistry);

    const preview = await previewPanelInstallation({
      config: configPath,
      configValue: config,
      output,
    });

    assert.match(preview.planId, /^sha256-/);
    assert.deepEqual(
      preview.changes.map(change => [change.type, change.panel.id]),
      [
        ['add', 'com.example.next'],
        ['remove', 'com.example.previous'],
      ]
    );
    assert.equal(await readFile(join(output, 'installed.json'), 'utf8'), previousRegistry);
    await assert.rejects(readFile(join(output, 'com.example.next/2.0.0/index.js')));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('applies the exact bytes held by a verified preview without fetching a third time', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'roboboy-panel-installer-exact-preview-'));
  try {
    const localRepository = join(temporaryRoot, 'local-panel');
    const panel = panelFixture('com.example.exact', '2.0.0', 'https://example.com', 'unused');
    await mkdir(join(localRepository, 'dist'), { recursive: true });
    await writeFile(join(localRepository, 'roboboy.panel.json'), JSON.stringify(panel.manifest));
    await writeFile(join(localRepository, 'dist/index.js'), panel.bundle);
    const configPath = join(temporaryRoot, 'sources.json');
    const output = join(temporaryRoot, 'panels');
    const preview = await previewPanelInstallation({
      config: configPath,
      configValue: {
        schemaVersion: 2,
        sources: [{ type: 'local', name: 'workspace', root: '.', repositories: ['./local-panel'] }],
        selection: { mode: 'all' },
      },
      output,
    });

    assert.equal(JSON.stringify(preview).includes('preparedInstallation'), false);
    await writeFile(join(localRepository, 'dist/index.js'), 'changed after verification');
    await applyPanelInstallationPreview(preview, { output });

    assert.equal(
      await readFile(join(output, panel.manifest.id, panel.manifest.version, 'index.js'), 'utf8'),
      panel.bundle.toString('utf8')
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
