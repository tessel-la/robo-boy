import { expect, test, type Locator, type Page } from '@playwright/test';
import { McapWriter, TempBuffer } from '@mcap/core';
import sharp from 'sharp';
import { getActiveRosSubscriptionCount, getRosSubscriptionCount, installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';
import { backToLayers, openLayerSettings } from './helpers/layerSettings';

const imageTopic = '/front/image_rect/compressed';
const rawTopic = '/front/image_raw';
const infoTopic = '/front/camera_info';
const header = (sec = 2, frame_id = 'optical') => ({ frame_id, stamp: { sec, nanosec: 0 } });
const info = () => ({
  header: header(0),
  width: 32,
  height: 32,
  distortion_model: 'plumb_bob',
  d: [0, 0, 0, 0, 0],
  k: [32, 0, 16, 0, 32, 16, 0, 0, 1],
  p: [32, 0, 16, 0, 0, 32, 16, 0, 0, 0, 1, 0],
  r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
});
const tf = (sec = 0) => ({
  transforms: [
    {
      header: header(sec, 'map'),
      child_frame_id: 'optical',
      transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    },
  ],
});
const rgb = (color?: 'red' | 'green' | 'blue') => {
  const data = Buffer.alloc(32 * 32 * 3);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const channel = color ? ['red', 'green', 'blue'].indexOf(color) : y < 16 ? (x < 16 ? 0 : 1) : 2;
      data[(y * 32 + x) * 3 + channel] = 255;
    }
  return data;
};
const png = async (color?: 'red' | 'green' | 'blue') =>
  sharp(rgb(color), { raw: { width: 32, height: 32, channels: 3 } })
    .png()
    .toBuffer();

async function pixels(canvas: Locator, color: 'red' | 'green' | 'blue') {
  const screenshot = await canvas.screenshot();
  const { width, height } = await sharp(screenshot).metadata();
  const { data, info } = await sharp(screenshot)
    .extract({ left: 0, top: 24, width: width! - 80, height: height! - 24 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const c = ['red', 'green', 'blue'].indexOf(color);
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (data[i + c] > 90 && data[i + c] > data[i + ((c + 1) % 3)] * 1.8 && data[i + c] > data[i + ((c + 2) % 3)] * 1.8)
      count++;
  return count;
}
async function openSettings(panel: Locator) {
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
}
async function addLayer(page: Page) {
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await openSettings(panel);
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Camera image (${imageTopic})`, { exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  return panel;
}

test('renders compressed/raw calibrated images, waits for TF and saves controls without resubscribing', async ({
  page,
}) => {
  await page.route('**/video_stream/**', route => route.fulfill({ status: 503, body: 'Camera streamer unavailable' }));
  await installRosMock(page, {
    topics: [
      { name: imageTopic, type: 'sensor_msgs/msg/CompressedImage' },
      { name: rawTopic, type: 'sensor_msgs/msg/Image' },
      { name: infoTopic, type: 'sensor_msgs/msg/CameraInfo' },
      { name: '/tf', type: 'tf2_msgs/msg/TFMessage' },
    ],
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const connect = async () => {
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 15_000 });
  };
  await connect();
  const panel = await addLayer(page);
  await openLayerSettings(panel, 'Camera image', imageTopic);
  await expect(panel.getByLabel(`Image source for Camera image on ${imageTopic}`)).toHaveValue('stream');
  await expect(panel.getByRole('status').filter({ hasText: 'Select ROS image messages' })).toBeVisible();
  expect(await getActiveRosSubscriptionCount(page, imageTopic)).toBe(0);
  await panel.getByLabel(`Image source for Camera image on ${imageTopic}`).selectOption('ros');
  for (const topic of [imageTopic, infoTopic, '/tf']) await waitForRosSubscription(page, topic);
  await publishRosMessage(page, imageTopic, {
    header: header(),
    format: 'png',
    data: (await png()).toString('base64'),
  });
  await expect(panel.locator('.visualization-status').first()).toContainText('CameraInfo');
  await publishRosMessage(page, infoTopic, info());
  for (const sec of [1, 3]) await publishRosMessage(page, '/tf', tf(sec));
  await expect(panel.getByRole('status').filter({ hasText: /Waiting|invalid|missing/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  for (const color of ['red', 'green', 'blue'] as const)
    await expect.poll(() => pixels(panel.locator('canvas'), color)).toBeGreaterThan(20);
  const counts = await Promise.all([imageTopic, infoTopic].map(topic => getRosSubscriptionCount(page, topic)));
  const heldBlue = await pixels(panel.locator('canvas'), 'blue');
  await publishRosMessage(page, imageTopic, {
    header: header(4),
    format: 'png',
    data: (await png('red')).toString('base64'),
  });
  // The last multicolour bitmap remains GPU-uploadable and visible while TF lags.
  for (let i = 0; i < 3; i++) expect(await pixels(panel.locator('canvas'), 'blue')).toBeGreaterThan(heldBlue / 2);
  await openSettings(panel);
  await expect(panel.getByRole('status').filter({ hasText: 'Showing last valid image' })).toBeVisible();
  await expect(panel.getByText('Flat image at the selected distance.', { exact: false })).toHaveCount(0);
  await publishRosMessage(page, '/tf', tf(5));
  await expect(panel.getByRole('status').filter({ hasText: /Showing last valid|Waiting/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(() => pixels(panel.locator('canvas'), 'blue')).toBeLessThan(heldBlue / 3);
  await expect.poll(() => pixels(panel.locator('canvas'), 'red')).toBeGreaterThan(20);
  await openSettings(panel);
  await openLayerSettings(panel, 'Camera image', imageTopic);
  await panel.getByLabel(`Image plane distance in metres for Camera image on ${imageTopic}`).fill('1.5');
  await panel.getByLabel(`Image plane distance in metres for Camera image on ${imageTopic}`).press('Enter');
  await panel.getByLabel(`Image opacity for Camera image on ${imageTopic}`).fill('0.4');
  await panel.getByLabel(`Show frustum for Camera image on ${imageTopic}`).uncheck();
  expect(await Promise.all([imageTopic, infoTopic].map(topic => getRosSubscriptionCount(page, topic)))).toEqual(counts);
  await backToLayers(panel);
  await panel.locator('[id^="visualization-topic-"]').selectOption(rawTopic);
  await waitForRosSubscription(page, rawTopic);
  await publishRosMessage(page, infoTopic, info());
  await publishRosMessage(page, rawTopic, {
    header: header(),
    width: 32,
    height: 32,
    encoding: 'rgb8',
    step: 96,
    data: rgb().toString('base64'),
  });
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(() => pixels(panel.locator('canvas'), 'red')).toBeGreaterThan(20);
  await page.reload();
  await connect();
  await openSettings(panel);
  await openLayerSettings(panel, 'Camera image', rawTopic);
  await expect(panel.getByLabel(`Image source for Camera image on ${rawTopic}`)).toHaveValue('ros');
  await expect(panel.getByLabel(`Image plane distance in metres for Camera image on ${rawTopic}`)).toHaveValue('1.50');
  await expect(panel.getByLabel(`Image opacity for Camera image on ${rawTopic}`)).toHaveValue('0.4');
  await expect(panel.getByLabel(`Show frustum for Camera image on ${rawTopic}`)).not.toBeChecked();
  expect(errors).toEqual([]);
});

async function recording() {
  const buffer = new TempBuffer(),
    writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: '', library: 'camera-image-3d-test' });
  for (const [topic, type, messages] of [
    ['/tf_static', 'tf2_msgs/msg/TFMessage', [tf()]],
    [infoTopic, 'sensor_msgs/msg/CameraInfo', [info()]],
    [
      imageTopic,
      'sensor_msgs/msg/CompressedImage',
      await Promise.all(
        (['green', 'red', 'blue'] as const).map(async (color, i) => ({
          header: header(i * 5 + 1),
          format: 'png',
          data: (await png(color)).toString('base64'),
        }))
      ),
    ],
  ] as const) {
    const schemaId = await writer.registerSchema({
      name: type,
      encoding: 'jsonschema',
      data: new TextEncoder().encode('{}'),
    });
    const channelId = await writer.registerChannel({ topic, schemaId, messageEncoding: 'json', metadata: new Map() });
    for (let i = 0; i < messages.length; i++) {
      const time = BigInt(i * 5) * 1_000_000_000n;
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: time,
        publishTime: time,
        data: new TextEncoder().encode(JSON.stringify(messages[i])),
      });
    }
  }
  await writer.end();
  return buffer.get();
}

test('replays camera textures through the real MCAP worker and restores frames after backward seek', async ({
  page,
}) => {
  let liveRequests = 0;
  await page.route('**/video_stream/**', route => {
    liveRequests++;
    return route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open local recordings', exact: true }).click();
  const replay = page.getByRole('region', { name: 'Record & Replay', exact: true });
  await replay.getByLabel('Open MCAP recording').setInputFiles({
    name: 'camera.mcap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await recording()),
  });
  await expect(replay.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  const panel = await addLayer(page);
  await openLayerSettings(panel, 'Camera image', imageTopic);
  await panel.getByLabel(`Image source for Camera image on ${imageTopic}`).selectOption('stream');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(() => pixels(panel.locator('canvas'), 'green')).toBeGreaterThan(20);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  const recorded = page.locator('.recorded-camera-frame');
  await expect(recorded).toBeVisible();
  await expect.poll(() => pixels(recorded, 'green')).toBeGreaterThan(20);
  const seek = replay.getByRole('slider', { name: 'Playback position', exact: true });
  await seek.fill('6');
  await expect.poll(() => pixels(panel.locator('canvas'), 'red')).toBeGreaterThan(20);
  await expect.poll(() => pixels(recorded, 'red')).toBeGreaterThan(20);
  const previousCanvas = await panel.locator('canvas').elementHandle();
  await seek.fill('1');
  await expect.poll(() => previousCanvas!.evaluate(element => element.isConnected)).toBe(false);
  await expect(panel.locator('canvas')).toBeVisible();
  await expect.poll(() => pixels(panel.locator('canvas'), 'green')).toBeGreaterThan(20);
  await expect.poll(() => pixels(recorded, 'green')).toBeGreaterThan(20);
  expect(liveRequests).toBe(0);
  expect(errors).toEqual([]);
});
