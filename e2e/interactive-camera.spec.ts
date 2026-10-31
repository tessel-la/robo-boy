import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { openLayerSettings, backToLayers } from './helpers/layerSettings';
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
  // A new layer starts on the streamer before this fixture selects ROS. Serve its
  // initial probe/response explicitly instead of relying on Vite's HTML fallback.
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } })
    .jpeg()
    .toBuffer();
  await page.route('**/video_stream/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/snapshot'))
      return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
    return route.fulfill({
      contentType: 'multipart/mixed; boundary=frame',
      body: Buffer.concat([
        Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
        jpeg,
        Buffer.from('\r\n--frame--\r\n'),
      ]),
    });
  });
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
  await openLayerSettings(panel, 'Camera image', topic);
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

test('keeps calibrated image projection and offers only image planes and depth points', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const panel = await setup(page);
  await expect(panel.getByLabel(`Projection mode for Camera image on ${topic}`)).toHaveValue('plane');
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
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  const mode = panel.getByLabel(`Projection mode for Camera image on ${topic}`);
  if (!(await mode.isVisible())) await openLayerSettings(panel, 'Camera image', topic);
  await expect(mode).toHaveValue('plane');
  await expect(mode.locator('option')).toHaveText(['Image plane', 'Depth points (ROS)']);
  expect(errors.filter(error => !error.includes('favicon'))).toEqual([]);
});

for (const theme of ['dark', 'light', 'solarized', 'custom-cobalt']) {
  test(`camera inspector and image settings follow ${theme} without narrow overflow`, async ({ page }, testInfo) => {
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
    await panel.getByLabel(`Projection mode for Camera image on ${topic}`).selectOption('plane');
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
  await backToLayers(panel);
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
