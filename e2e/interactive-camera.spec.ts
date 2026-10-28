import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import {
  installRosMock,
  publishRosMessage,
  waitForRosSubscription,
  getActiveRosSubscriptionCount,
} from './helpers/rosMock';

const topic = '/front/image_raw';
const infoTopic = '/front/camera_info';
const description = '/robot_description';
const header = (sec = 2) => ({ frame_id: 'optical', stamp: { sec, nanosec: 0 } });
const image = (sec = 2, color = [255, 0, 0]) => ({
  header: header(sec),
  width: 2,
  height: 2,
  step: 6,
  encoding: 'rgb8',
  data: [...color, ...color, ...color, ...color],
});
async function setup(page: Page) {
  await installRosMock(page, {
    topics: [
      { name: topic, type: 'sensor_msgs/msg/Image' },
      { name: infoTopic, type: 'sensor_msgs/msg/CameraInfo' },
      { name: description, type: 'std_msgs/msg/String' },
      { name: '/tf_static', type: 'tf2_msgs/msg/TFMessage' },
    ],
    services: [{ name: '/camera/capture', type: 'camera/srv/Capture' }],
    serviceCalls: { '/camera/capture': [{ values: { success: true, image: image(10, [0, 255, 0]) } }] },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const title of [`Add URDF (default: ${description})`, `Add Camera image (${topic})`]) {
    await panel.getByRole('tab', { name: /^Visualizations/ }).click();
    await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByTitle(title, { exact: true }).click();
  }
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await panel.getByLabel(`Display settings for Camera image on ${topic}`, { exact: true }).click();
  await panel.getByLabel(`Image source for Camera image on ${topic}`, { exact: true }).selectOption('ros');
  await waitForRosSubscription(page, topic);
  await waitForRosSubscription(page, infoTopic);
  await waitForRosSubscription(page, description);
  await waitForRosSubscription(page, '/tf_static');
  await publishRosMessage(page, description, {
    data: '<robot name="wall"><link name="wall"><visual><origin xyz="0 0 2"/><geometry><box size="2 2 0.1"/></geometry><material name="white"><color rgba="1 1 1 1"/></material></visual></link></robot>',
  });
  await publishRosMessage(page, '/tf_static', {
    transforms: ['optical', 'wall'].map(child_frame_id => ({
      header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
      child_frame_id,
      transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    })),
  });
  await publishRosMessage(page, infoTopic, {
    header: header(0),
    width: 2,
    height: 2,
    k: [2, 0, 1, 0, 2, 1, 0, 0, 1],
    d: [],
  });
  await publishRosMessage(page, topic, image());
  return panel;
}

test('inspects a camera, freezes exact snapshots, captures through a service and opens the same ROS source', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const panel = await setup(page);
  await panel.getByLabel(`Inspect camera on ${topic}`).click();
  const inspector = panel.getByRole('region', { name: `Camera inspector for ${topic}` });
  await expect(inspector).toContainText('2 × 2');
  await expect(inspector).toContainText('2000000000 ns');
  await inspector.getByRole('button', { name: 'Freeze projection', exact: true }).click();
  await publishRosMessage(page, topic, image(3, [0, 0, 255]));
  await expect(inspector).toContainText('2000000000 ns');
  const saved = page.waitForEvent('download');
  await inspector.getByRole('button', { name: 'Save displayed image', exact: true }).click();
  const png = await sharp((await (await saved).path())!)
    .raw()
    .toBuffer();
  expect(png[0]).toBe(255);
  expect(png[1]).toBe(0);
  expect(png[2]).toBe(0);
  await inspector.getByRole('button', { name: 'Resume projection', exact: true }).click();
  await expect(inspector).toContainText('3000000000 ns');
  await inspector.getByText('On-demand capture', { exact: true }).click();
  await inspector.getByLabel('Service/action name', { exact: true }).fill('/camera/capture');
  await inspector.getByLabel('Interface type', { exact: true }).fill('camera/srv/Capture');
  const captured = page.waitForEvent('download');
  await inspector.getByRole('button', { name: 'Request capture and save', exact: true }).click();
  await captured;
  await expect(inspector).toContainText('Captured image saved.');
  const before = await getActiveRosSubscriptionCount(page, topic);
  await inspector.getByRole('button', { name: 'Open in Camera', exact: true }).click();
  await expect(page.locator('.camera-view')).toBeVisible();
  await page.locator('.camera-view').getByRole('button', { name: 'Camera settings', exact: true }).click();
  await expect(page.getByLabel('Camera image source')).toHaveValue('ros');
  await expect.poll(() => getActiveRosSubscriptionCount(page, topic)).toBe(before);
  await expect(page.locator('.camera-view canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('projects onto URDF surfaces in WebGL, switches timing explicitly and retains settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const panel = await setup(page);
  await panel.getByLabel(`Projection mode for Camera image on ${topic}`).selectOption('surfaces');
  await panel.getByLabel(`Project onto urdf ${description}`).check();
  await panel.getByLabel(`Surface geometry timing for Camera image on ${topic}`).selectOption('image');
  await panel.getByLabel(`Inspect camera on ${topic}`).click();
  const inspector = panel.getByRole('region', { name: `Camera inspector for ${topic}` });
  await inspector.getByRole('button', { name: 'Look through camera', exact: true }).click();
  await inspector.getByRole('button', { name: 'Close camera inspector' }).click();
  const red = async () => {
    const { data, info } = await sharp(await panel.locator('canvas').screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let count = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] > 180 && data[i + 1] < 60 && data[i + 2] < 60) count++;
    return count;
  };
  await expect.poll(red).toBeGreaterThan(5000);
  await panel.screenshot({ path: '/tmp/roboboy-camera-surfaces.png' });
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  const mode = panel.getByLabel(`Projection mode for Camera image on ${topic}`);
  if (!(await mode.isVisible()))
    await panel.getByLabel(`Display settings for Camera image on ${topic}`, { exact: true }).click();
  await expect(mode).toHaveValue('surfaces');
  await expect(panel.getByLabel(`Project onto urdf ${description}`)).toBeChecked();
  await panel.getByLabel(`Surface geometry timing for Camera image on ${topic}`).selectOption('latest');
  await expect(panel).toContainText('Surface projection uses latest scene geometry');
  expect(errors.filter(error => !error.includes('favicon'))).toEqual([]);
});

test('surface projection stops at occluders from the projector viewpoint and leaves original materials untouched', async ({
  page,
}) => {
  test.skip(
    process.env.npm_lifecycle_event === 'e2e:stack',
    'This isolated renderer fixture imports Vite source modules.'
  );
  await setup(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const point = await page.evaluate(async () => {
    const viewerPath = '/src/utils/ros3d.ts',
      projectionPath = '/src/utils/ros3d/visualizers/CameraSurface.ts';
    const compiled = await (await fetch(projectionPath)).text();
    const threePath = compiled.match(/import \* as THREE from ["']([^"']+)["']/)?.[1];
    if (!threePath) throw new Error('Three.js module not loaded');
    const THREE = await import(threePath);
    const { Viewer } = await import(viewerPath);
    const { CameraSurfaceProjection } = await import(projectionPath);
    const host = document.createElement('div');
    host.id = 'projection-proof';
    Object.assign(host.style, { position: 'fixed', inset: '0', width: '500px', height: '500px', zIndex: '10000' });
    document.body.append(host);
    const viewer = new Viewer({ divID: host.id, width: 500, height: 500, antialias: false });
    viewer.camera.position.set(4, 0, 1);
    viewer.camera.up.set(0, 1, 0);
    viewer.camera.lookAt(0, 0, 4);
    const layer = new THREE.Group();
    layer.userData.projectionLayer = 'wall';
    viewer.scene.add(layer);
    const original = new THREE.MeshBasicMaterial({ color: 'white' });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.1), original);
    wall.position.z = 4;
    layer.add(wall);
    const other = new THREE.Group();
    other.userData.projectionLayer = 'blocker';
    viewer.scene.add(other);
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.5), new THREE.MeshBasicMaterial({ color: 'white' }));
    blocker.position.z = 2;
    other.add(blocker);
    const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    const snapshot = {
      frame: { header: {} },
      position: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
      fixedFrame: 'map',
      corners: [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    };
    const source = {
      object: { visible: true },
      plane: { material: { map: texture } },
      getSnapshot: () => ({ displayed: snapshot }),
    };
    const projection = new CameraSurfaceProjection(viewer, source, {}, () => {});
    projection.updateOptions({ renderMode: 'surfaces', surfaceTargets: ['wall'], surfaceTiming: 'latest' });
    viewer.render();
    const projected = new THREE.Vector3(0, 0, 3.949).project(viewer.camera);
    (window as any).__surfaceProof = { viewer, projection, blocker, wall, original };
    return { x: Math.round((projected.x + 1) * 250), y: Math.round((1 - projected.y) * 250) };
  });
  const canvas = page.locator('#projection-proof canvas');
  const sample = async () => {
    const { data } = await sharp(await canvas.screenshot())
      .extract({ left: point.x - 2, top: point.y - 2, width: 5, height: 5 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
  };
  await expect.poll(async () => (await sample())[1]).toBeGreaterThan(180);
  await page.evaluate(() => {
    const p = (window as any).__surfaceProof;
    p.blocker.visible = false;
    p.viewer.requestRender();
  });
  await expect.poll(async () => (await sample())[1]).toBeLessThan(30);
  expect(
    await page.evaluate(() => {
      const p = (window as any).__surfaceProof;
      return p.wall.material === p.original;
    })
  ).toBe(true);
  await page.evaluate(() => {
    const p = (window as any).__surfaceProof;
    p.projection.dispose();
    p.viewer.requestRender();
  });
  await expect.poll(async () => (await sample())[1]).toBeGreaterThan(180);
  expect(errors).toEqual([]);
});

for (const theme of ['dark', 'light', 'solarized', 'custom-cobalt']) {
  test(`camera inspector and surface settings follow ${theme} without narrow overflow`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('appTheme', theme);
      localStorage.setItem(
        'customThemes',
        JSON.stringify([
          {
            id: 'custom-cobalt',
            name: 'Cobalt test',
            fontFamily: "Georgia, 'Times New Roman', serif",
            colors: {
              primary: '#ff9c70',
              secondary: '#77c8ff',
              background: '#112866',
              text: '#f5efd9',
              border: '#657cb7',
              cardBg: '#19316a',
              buttonText: '#14234a',
            },
          },
        ])
      );
    }, theme);
    const panel = await setup(page);
    // Test a narrow tile while retaining the desktop workspace and its configured layer.
    await panel.evaluate(element => {
      element.style.width = '370px';
      element.style.maxWidth = '100%';
    });
    await panel.getByLabel(`Projection mode for Camera image on ${topic}`).selectOption('surfaces');
    const settings = panel.locator('.settings-popup');
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await panel.getByLabel(`Inspect camera on ${topic}`).click();
    const inspector = panel.getByRole('region', { name: `Camera inspector for ${topic}` });
    await inspector.getByText('On-demand capture', { exact: true }).click();
    await expect(inspector.getByLabel('Interface type', { exact: true })).toBeVisible();
    expect(await inspector.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(
      await inspector
        .getByLabel('Interface type', { exact: true })
        .evaluate(element => getComputedStyle(element).fontFamily)
    ).toBe(await inspector.evaluate(element => getComputedStyle(element).fontFamily));
    await inspector.screenshot({ path: testInfo.outputPath(`camera-inspector-${theme}.png`) });
  });
}

test('CameraInfo-only frustums remain inspectable without an image and open calibration in Explorer', async ({
  page,
}) => {
  const panel = await setup(page);
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Camerainfo (${infoTopic})`, { exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await publishRosMessage(page, infoTopic, {
    header: header(0),
    width: 2,
    height: 2,
    k: [2, 0, 1, 0, 2, 1, 0, 0, 1],
    d: [],
  });
  await panel.getByLabel(`Inspect camera on ${infoTopic}`).click();
  const inspector = panel.getByRole('region', { name: `Camera inspector for ${infoTopic}` });
  await expect(inspector).toContainText('optical');
  await expect(inspector.getByRole('button', { name: 'Save displayed image' })).toBeDisabled();
  await inspector.getByText('Related panels', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Inspect CameraInfo', exact: true }).click();
  const explorer = page.locator('.data-explorer-panel');
  await expect(explorer).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Copy resource name' })).toBeVisible();
  await expect(explorer).toContainText(infoTopic);
});
