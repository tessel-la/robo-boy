import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createThirdPartyNotices, thirdPartyNoticesPlugins } from './third-party-notices.mjs';

test('notices follow bundle inputs and retain dependency LICENSE and NOTICE text', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'roboboy-notices-'));
  try {
    const used = path.join(root, 'node_modules/used');
    const unused = path.join(root, 'node_modules/unused');
    for (const [directory, name] of [
      [used, 'used'],
      [unused, 'unused'],
    ]) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }));
    }
    await writeFile(path.join(used, 'LICENSE'), 'Copyright the upstream author. Permission to distribute.');
    await writeFile(path.join(used, 'NOTICE'), 'Required upstream attribution.');
    const result = await createThirdPartyNotices([path.join(used, 'index.js')]);
    assert.match(result, /used@1.0.0/);
    assert.match(result, /Copyright the upstream author/);
    assert.match(result, /Required upstream attribution/);
    assert.doesNotMatch(result, /unused@1.0.0/);
    assert.match(result, /Font Awesome Free 5/);
    assert.match(result, /Apache License/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a license declaration without source license material cannot silently pass a release build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'roboboy-notices-'));
  const directory = path.join(root, 'node_modules/missing');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'missing', version: '1.0.0' }));
    const inputs = [path.join(directory, 'index.js')];
    await assert.rejects(createThirdPartyNotices(inputs), /No license text found/);
    await writeFile(path.join(directory, 'README.md'), '# License\nMIT\n');
    await assert.rejects(createThirdPartyNotices(inputs), /No license text found/);
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'missing', version: '1.0.0', license: 'MIT' })
    );
    assert.match(await createThirdPartyNotices(inputs), /# License\nMIT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('omitted npm licenses use only reviewed release-specific source texts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'roboboy-source-notices-'));
  const directory = path.join(root, 'node_modules/@ai-sdk/provider-utils');
  const manifest = { name: '@ai-sdk/provider-utils', version: '5.0.56', license: 'Apache-2.0' };
  const inputs = [path.join(directory, 'index.js')];
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    assert.match(await createThirdPartyNotices(inputs), /Copyright 2023 Vercel, Inc\./);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...manifest, version: '5.0.57' }));
    await assert.rejects(createThirdPartyNotices(inputs), /No license text found/);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...manifest, license: 'MIT' }));
    await assert.rejects(createThirdPartyNotices(inputs), /No license text found/);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: '@cfworker/json-schema', version: '4.1.1', license: 'MIT' }));
    assert.match(await createThirdPartyNotices(inputs), /Jeremy Danyow/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Vite includes a dependency used only by a worker in the app notice file', async () => {
  const { build } = await import('vite');
  const root = await mkdtemp(path.join(tmpdir(), 'roboboy-worker-notices-'));
  try {
    const dependency = path.join(root, 'node_modules/worker-only');
    await mkdir(dependency, { recursive: true });
    await writeFile(
      path.join(dependency, 'package.json'),
      JSON.stringify({
        name: 'worker-only',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        license: 'MIT',
      })
    );
    await writeFile(path.join(dependency, 'index.js'), 'export const value = 42;');
    await writeFile(path.join(dependency, 'LICENSE'), 'Worker-only upstream license text.');
    await writeFile(
      path.join(root, 'main.js'),
      "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });"
    );
    await writeFile(path.join(root, 'worker.js'), "import { value } from 'worker-only'; postMessage(value);");
    const notices = thirdPartyNoticesPlugins();
    await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [notices.app],
      worker: { plugins: () => [notices.worker] },
      build: { rollupOptions: { input: path.join(root, 'main.js') } },
    });
    const text = await readFile(path.join(root, 'dist/licenses.txt'), 'utf8');
    assert.match(text, /worker-only@1.0.0/);
    assert.match(text, /Worker-only upstream license text/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
