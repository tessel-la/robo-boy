import { expect, test, type Page, type Locator } from '@playwright/test';
import {
  installRosMock,
  publishRosMessage,
  getPublishedRosMessages,
  getActiveRosSubscriptionCount,
} from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

const panelId = 'xr-explorer';
declare global {
  interface Window {
    __xrExplorer: import('../src/xr/panels/registry').XrPanelInstance;
    __xrExplorerPresses: number;
    __xrExplorerActivations: number;
  }
}
const explorer = (page: Page) => page.locator('.data-explorer-panel');
async function waitForPaintedTarget(page: Page, locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate(element => {
        const r = element.getBoundingClientRect();
        const root = element.closest('.data-explorer-panel')!.getBoundingClientRect();
        const object = window.__xrScene.uiGroup.getObjectByName('xr-data-explorer-surface')!;
        return (
          window.__xrExplorer.getActivationTarget!({
            object,
            uv: {
              x: (r.left + r.width / 2 - root.left) / root.width,
              y: 1 - (r.top + r.height / 2 - root.top) / root.height,
            },
          } as import('../src/xr/XrInputManager').XrInputTarget) === element
        );
      })
    )
    .toBe(true);
}
async function aim(page: Page, locator: Locator) {
  const position = await locator.evaluate(element => {
    const r = element.getBoundingClientRect(),
      root = element.closest('.data-explorer-panel')!.getBoundingClientRect();
    return {
      u: (r.left + r.width / 2 - root.left) / root.width,
      v: 1 - (r.top + r.height / 2 - root.top) / root.height,
    };
  });
  await page.evaluate(async ({ u, v }) => {
    const path = '/node_modules/.vite/deps/three.js';
    const THREE = await import(/* @vite-ignore */ path);
    const mesh = window.__xrScene.uiGroup.getObjectByName('xr-data-explorer-surface')!;
    const point = mesh.localToWorld(new THREE.Vector3(u - 0.5, v - 0.5, 0));
    const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
    const origin = point.clone().add(new THREE.Vector3(0, 0, 0.5).applyQuaternion(rotation));
    const controller = window.__xrDevice.controllers.right!;
    controller.position.set(origin.x, origin.y, origin.z);
    controller.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }, position);
  await page.waitForTimeout(100);
}
async function press(page: Page, locator: Locator) {
  await waitForPaintedTarget(page, locator);
  await aim(page, locator);
  const before = await page.evaluate(() => ({
    presses: window.__xrExplorerPresses,
    activations: window.__xrExplorerActivations,
  }));
  await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 1));
  await expect.poll(() => page.evaluate(() => window.__xrExplorerPresses)).toBeGreaterThan(before.presses);
  await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 0));
  await expect.poll(() => page.evaluate(() => window.__xrExplorerActivations)).toBeGreaterThan(before.activations);
}
async function key(page: Page, id: string) {
  await page.evaluate(async id => {
    const path = '/src/xr/ui/SurfaceInteraction.ts';
    const { SurfaceInteraction } = await import(/* @vite-ignore */ path);
    const mesh = window.__xrScene.uiGroup.getObjectByName('xr-data-explorer-keyboard')!;
    const surface = mesh.userData.xrSurface,
      item = surface.getItem(id);
    new SurfaceInteraction().activate({
      object: mesh,
      uv: { x: (item.x + item.w / 2) / surface.pixelWidth, y: 1 - (item.y + item.h / 2) / surface.pixelHeight },
    });
  }, id);
}
for (const mode of ['VR', 'AR'] as const) {
  test(`Data Explorer in ${mode} shares inspection, keyboard, health, graph and panel actions`, async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installXrEmulator(page);
    await installRosMock(page, {
      topics: [
        { name: '/speed', type: 'std_msgs/msg/Float64' },
        { name: '/diagnostics', type: 'diagnostic_msgs/msg/DiagnosticArray' },
        { name: '/diagnostics_agg', type: 'diagnostic_msgs/msg/DiagnosticArray' },
      ],
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'xr-explorer', type: 'dataExplorer', title: 'Data Explorer' }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-explorer']));
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await publishRosMessage(page, '/roboboy/inspection/graph', {
      data: JSON.stringify({
        version: 1,
        revision: 1,
        age: 0,
        resources: [
          {
            kind: 'topic',
            name: '/speed',
            types: ['std_msgs/msg/Float64'],
            providers: ['/base'],
            consumers: ['/ui'],
            publishers: 1,
            subscribers: 1,
            countKind: 'endpoints',
          },
          {
            kind: 'topic',
            name: '/diagnostics',
            types: ['diagnostic_msgs/msg/DiagnosticArray'],
            providers: ['/base'],
            consumers: [],
            publishers: 1,
            subscribers: 0,
            countKind: 'endpoints',
          },
          { kind: 'node', name: '/base', types: [], providers: [], consumers: [] },
          { kind: 'node', name: '/ui', types: [], providers: [], consumers: [] },
        ],
      }),
    });
    await expect(explorer(page).locator('.de-resource-row', { hasText: '/speed' })).toBeVisible();
    const desktopWidth = await explorer(page).evaluate(element => element.getBoundingClientRect().width);
    await observeXrScene(page);
    await page.evaluate(async () => {
      const path = '/src/xr/panels/dataExplorerRenderer.ts';
      const { dataExplorerPanelRenderer } = await import(/* @vite-ignore */ path);
      const create = dataExplorerPanelRenderer.create;
      dataExplorerPanelRenderer.create = (...args: Parameters<typeof create>) => {
        const instance = create(...args);
        window.__xrExplorer = instance;
        window.__xrExplorerPresses = 0;
        window.__xrExplorerActivations = 0;
        const press = instance.onPressStart!;
        const activate = instance.onActivate!;
        instance.onPressStart = (...args) => {
          window.__xrExplorerPresses++;
          press(...args);
        };
        instance.onActivate = (...args) => {
          window.__xrExplorerActivations++;
          activate(...args);
        };
        return instance;
      };
    });
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => page.evaluate(() => window.__xrScene?.renderer.xr.isPresenting)).toBe(true);
    await expect(explorer(page)).toHaveAttribute('data-xr-presented', 'true');
    await page.evaluate(async () => {
      const path = '/src/panels/capturePanelSurface.ts';
      const { capturePanelSurface } = await import(/* @vite-ignore */ path);
      const root = document.querySelector('.data-explorer-panel') as HTMLElement;
      const elements = [root, ...root.querySelectorAll('*')];
      const before = elements.map(element => element.getAttribute('style'));
      const svgs = [...root.querySelectorAll('svg')];
      const sizes = svgs.map(svg => [svg.getAttribute('width'), svg.getAttribute('height')]);
      const capture = capturePanelSurface(root, root.clientWidth, root.clientHeight);
      if (JSON.stringify(before) !== JSON.stringify(elements.map(element => element.getAttribute('style'))))
        throw new Error(
          'Capture changed desktop inline styles: ' +
            JSON.stringify(
              elements.flatMap((element, i) =>
                before[i] === element.getAttribute('style')
                  ? []
                  : [
                      {
                        element: element.outerHTML.slice(0, 300),
                        before: before[i],
                        after: element.getAttribute('style'),
                      },
                    ]
              )
            )
        );
      if (
        JSON.stringify(sizes) !==
        JSON.stringify(svgs.map(svg => [svg.getAttribute('width'), svg.getAttribute('height')]))
      )
        throw new Error('Capture changed desktop SVG dimensions');
      await capture;
    });
    await press(page, explorer(page).getByRole('searchbox', { name: 'Search resources' }));
    await expect
      .poll(() => page.evaluate(() => window.__xrScene.uiGroup.getObjectByName('xr-data-explorer-keyboard')!.visible))
      .toBe(true);
    for (const char of 'speed') await key(page, `key-${char}`);
    await key(page, 'apply-input');
    await expect(explorer(page).getByRole('searchbox', { name: 'Search resources' })).toHaveValue('speed');
    const row = explorer(page).locator('.de-resource-row', { hasText: '/speed' });
    await press(page, row.locator('.de-resource-main'));
    await expect(explorer(page).getByRole('complementary', { name: '/speed inspector' })).toBeVisible();
    await press(page, explorer(page).getByRole('button', { name: 'Watch traffic of /speed', exact: true }).last());
    await expect
      .poll(async () => JSON.stringify(await getPublishedRosMessages(page, '/roboboy/inspection/request')))
      .toContain('/speed');
    await press(page, explorer(page).getByRole('button', { name: 'Graph', exact: true }));
    await expect(explorer(page).locator('.react-flow__node')).not.toHaveCount(0);
    await page.waitForTimeout(650);
    await saveXrPanelPreview(page, panelId, `/tmp/robo-boy-xr-explorer-graph-${mode.toLowerCase()}.png`);
    const node = explorer(page).locator('.react-flow__node').first();
    const nodeId = await node.getAttribute('data-id');
    const before = await node.getAttribute('style');
    await page.waitForTimeout(650);
    await aim(page, node);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__xrDevice.controllers.right!.position.x += 0.045;
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 0));
    await expect(explorer(page).locator(`.react-flow__node[data-id="${nodeId}"]`)).not.toHaveAttribute(
      'style',
      before!
    );
    await press(page, explorer(page).getByRole('button', { name: 'Health', exact: true }));
    // Search applies to diagnostics too; clear it through the immersive keyboard.
    await press(page, explorer(page).getByRole('searchbox', { name: 'Search resources' }));
    await expect
      .poll(() => page.evaluate(() => window.__xrScene.uiGroup.getObjectByName('xr-data-explorer-keyboard')!.visible))
      .toBe(true);
    await key(page, 'clear');
    await key(page, 'apply-input');
    await expect(explorer(page).getByRole('searchbox', { name: 'Search resources' })).toHaveValue('');
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/diagnostics')).toBeGreaterThan(0);
    await publishRosMessage(page, '/diagnostics', {
      status: [
        {
          name: 'Drive',
          hardware_id: 'base',
          level: 1,
          message: 'Warm motor',
          values: [{ key: 'temperature', value: '72' }],
        },
      ],
    });
    await expect(explorer(page).getByText('Drive', { exact: true })).toBeVisible();
    await press(page, explorer(page).locator('.de-diagnostic summary'));
    await expect(explorer(page).getByText('Warm motor', { exact: true })).toBeVisible();
    await page.waitForTimeout(650);
    await saveXrPanelPreview(page, panelId, `/tmp/robo-boy-xr-explorer-health-${mode.toLowerCase()}.png`);
    await press(page, explorer(page).getByLabel('Diagnostic source'));
    await pressXrControl(page, panelId, 'row-1');
    await expect(explorer(page).getByLabel('Diagnostic source')).toHaveValue('/diagnostics_agg');
    await press(page, explorer(page).getByRole('button', { name: 'Resources', exact: true }));
    await press(page, explorer(page).locator('.de-resource-row', { hasText: '/speed' }).locator('.de-resource-main'));
    await press(page, explorer(page).getByRole('button', { name: 'Record /speed', exact: true }).last());
    await expect(page.locator('[data-workspace-card-id]')).toHaveCount(2);
    await page.evaluate(() => window.__xrSession.end());
    await expect(explorer(page)).not.toHaveAttribute('data-xr-presented');
    await expect
      .poll(() => explorer(page).evaluate(element => element.getBoundingClientRect().width))
      .toBeLessThanOrEqual(desktopWidth);
    expect(errors).toEqual([]);
  });
}
