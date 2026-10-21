/** Company packages must never install stock releases over their compiled login configuration. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';

for (const [name, enterprise, packaged, enabled] of [
  ['Sunrise Robotics Robo-Boy', false, true, false],
  ['Robo-Boy', true, true, false],
  ['Robo-Boy', false, false, false],
  ['Robo-Boy', false, true, true],
  ['</script><script>globalThis.updaterTestInjected = true</script>', false, true, false],
  ['"; globalThis.updaterTestInjected = true; //', false, true, false],
  ['Company\u2028Name\u2029', false, true, false],
]) {
  const handlers = new Map();
  globalThis.updaterTestHandlers = handlers;
  // Fixture values are runtime data, never interpolated into the module's JavaScript source.
  globalThis.updaterTestApp = { name, packaged };
  const result = await build({
    entryPoints: ['electron/updater.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    define: {
      __ROBOBOY_ENTERPRISE_LOGIN__: JSON.stringify(enterprise),
      'process.platform': JSON.stringify('darwin'),
      'process.arch': JSON.stringify('arm64'),
      'process.execPath': JSON.stringify('/Applications/Robo-Boy.app/Contents/MacOS/Robo-Boy'),
    },
    plugins: [
      {
        name: 'electron-test',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
          builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents: `
          export const app = {
            get isPackaged() { return globalThis.updaterTestApp.packaged; },
            getName: () => globalThis.updaterTestApp.name,
          };
          export const ipcMain = {handle: (name, handler) => globalThis.updaterTestHandlers.set(name, handler)};
          export const shell = {};
        `,
          }));
        },
      },
    ],
  });
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
  module.registerUpdater();
  assert.deepEqual(
    await handlers.get('roboboy:update-target')(),
    enabled ? { shell: 'electron', os: 'macos', arch: 'arm64', package: 'dmg' } : null
  );
  if (!enabled) {
    await assert.rejects(
      handlers.get('roboboy:update-download')({ sender: {} }, 'robo-boy-v1.0.0', 'Robo-Boy-macos-arm64-electron.dmg'),
      /application administrator/
    );
  }
  assert.equal(globalThis.updaterTestInjected, undefined);
}
delete globalThis.updaterTestHandlers;
delete globalThis.updaterTestApp;
console.log('PASS company and enterprise apps refuse stock updates; standard packaged apps retain their updater.');
