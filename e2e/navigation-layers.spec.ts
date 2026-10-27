import { expect, test, type Locator, type Page } from '@playwright/test';
import { McapWriter, TempBuffer } from '@mcap/core';
import sharp from 'sharp';
import { getRosSubscriptionCount, installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';

const header = (frame_id = 'map', sec = 2) => ({ frame_id, stamp: { sec, nanosec: 0 } });
const plan = (frame = 'map', y = 0) => ({
  header: header(frame),
  poses: [-1, 0, 1].map(x => ({ pose: { position: { x, y, z: 0.1 } } })),
});
const map = (frame = 'map') => ({
  header: header(frame),
  info: {
    width: 4,
    height: 4,
    resolution: 0.5,
    origin: { position: { x: -1, y: -1, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  },
  data: [0, 0, 100, 100, 0, 0, 100, 100, -1, -1, 50, 50, -1, -1, 50, 50],
});

async function addNavigationLayers(page: Page) {
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const title of ['Add Path (/robot/plan)', 'Add Occupancy grid (/robot/map)']) {
    await panel.getByRole('tab', { name: /^Visualizations/ }).click();
    while (await panel.locator('.visualization-options:not([open]) > summary').count()) {
      await panel.locator('.visualization-options:not([open]) > summary').first().click();
    }
    await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByTitle(title, { exact: true }).click();
  }
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  while (await panel.locator('.visualization-options:not([open]) > summary').count()) {
    await panel.locator('.visualization-options:not([open]) > summary').first().click();
  }
  return panel;
}

async function coloredPixels(canvas: Locator, color: 'green' | 'unknown' = 'green') {
  const screenshot = await canvas.screenshot();
  const size = await sharp(screenshot).metadata();
  // The floating assistant overlaps the canvas at its bottom-right corner.
  const { data, info } = await sharp(screenshot)
    .extract({ left: 0, top: 24, width: size.width! - 80, height: size.height! - 24 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (color === 'green' ? g > 80 && g > r * 1.8 && g > b * 1.3 : b > 40 && b > g * 1.08 && g > r * 1.08) count++;
  }
  return count;
}

test('renders paths/maps, recovers with timestamped TF and persists independent layer settings', async ({ page }) => {
  await installRosMock(page, {
    topics: [
      { name: '/tf', type: 'tf2_msgs/msg/TFMessage' },
      { name: '/robot/plan', type: 'nav_msgs/msg/Path' },
      { name: '/robot/map', type: 'nav_msgs/msg/OccupancyGrid' },
    ],
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const connect = async () => {
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
  };
  await connect();
  const panel = await addNavigationLayers(page);
  for (const topic of ['/tf', '/robot/plan', '/robot/map']) await waitForRosSubscription(page, topic);
  const counts = await Promise.all(['/robot/plan', '/robot/map'].map(topic => getRosSubscriptionCount(page, topic)));
  await publishRosMessage(page, '/robot/plan', plan('odom'));
  await publishRosMessage(page, '/robot/map', map('odom'));
  await expect(panel.locator('.visualization-status')).toHaveCount(2);
  for (const sec of [1, 3])
    await publishRosMessage(page, '/tf', {
      transforms: [
        {
          header: header('map', sec),
          child_frame_id: 'odom',
          transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      ],
    });
  await expect(panel.locator('.visualization-status')).toHaveCount(0);
  await panel.getByLabel('Line width in metres for Path on /robot/plan').fill('0.08');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(() => coloredPixels(panel.locator('canvas'))).toBeGreaterThan(30);
  await expect.poll(() => coloredPixels(panel.locator('canvas'), 'unknown')).toBeGreaterThan(30);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  while (await panel.locator('.visualization-options:not([open]) > summary').count()) {
    await panel.locator('.visualization-options:not([open]) > summary').first().click();
  }
  await panel.getByLabel('Show Path on /robot/plan').uncheck();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(() => coloredPixels(panel.locator('canvas'))).toBe(0);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  while (await panel.locator('.visualization-options:not([open]) > summary').count()) {
    await panel.locator('.visualization-options:not([open]) > summary').first().click();
  }
  await panel.getByLabel('Color for Path on /robot/plan').fill('#ff0000');
  await panel.getByLabel('Opacity for Path on /robot/plan').fill('0.45');
  await panel.getByLabel('Opacity for Occupancy grid on /robot/map').fill('0.2');
  expect(await Promise.all(['/robot/plan', '/robot/map'].map(topic => getRosSubscriptionCount(page, topic)))).toEqual(
    counts
  );
  await page.reload();
  await connect();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  while (await panel.locator('.visualization-options:not([open]) > summary').count()) {
    await panel.locator('.visualization-options:not([open]) > summary').first().click();
  }
  await expect(panel.getByLabel('Show Path on /robot/plan')).not.toBeChecked();
  await expect(panel.getByLabel('Color for Path on /robot/plan')).toHaveValue('#ff0000');
  await expect(panel.getByLabel('Line width in metres for Path on /robot/plan')).toHaveValue('0.080');
  await expect(panel.getByLabel('Opacity for Occupancy grid on /robot/map')).toHaveValue('0.2');
  expect(errors).toEqual([]);
});

async function navigationMcap() {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: '', library: 'navigation-test' });
  for (const [topic, type, values] of [
    [
      '/tf_static',
      'tf2_msgs/msg/TFMessage',
      [
        {
          transforms: [
            {
              header: header('world', 0),
              child_frame_id: 'map',
              transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
            },
          ],
        },
      ],
    ],
    ['/robot/plan', 'nav_msgs/msg/Path', [plan('map', -0.5), { poses: [] }, plan('map', 0.5)]],
    ['/robot/map', 'nav_msgs/msg/OccupancyGrid', [map(), { info: { width: 0, height: 0 }, data: [] }, map()]],
  ] as const) {
    const schemaId = await writer.registerSchema({
      name: type,
      encoding: 'jsonschema',
      data: new TextEncoder().encode('{}'),
    });
    const channelId = await writer.registerChannel({ topic, schemaId, messageEncoding: 'json', metadata: new Map() });
    for (let i = 0; i < values.length; i++) {
      const time = BigInt(i * 5) * 1_000_000_000n;
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: time,
        publishTime: time,
        data: new TextEncoder().encode(JSON.stringify(values[i])),
      });
    }
  }
  await writer.end();
  return buffer.get();
}

test('renders recorded paths/maps and restores them after backward seeks without a robot connection', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open local recordings', exact: true }).click();
  const replay = page.getByRole('region', { name: 'Record & Replay', exact: true });
  await replay.getByLabel('Open MCAP recording').setInputFiles({
    name: 'navigation.mcap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await navigationMcap()),
  });
  await expect(replay.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  const panel = await addNavigationLayers(page);
  await expect(panel.locator('.visualization-status')).toHaveCount(0);
  await panel.getByLabel('Line width in metres for Path on /robot/plan').fill('0.08');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(() => coloredPixels(panel.locator('canvas'))).toBeGreaterThan(10);
  await expect.poll(() => coloredPixels(panel.locator('canvas'), 'unknown')).toBeGreaterThan(10);
  const seek = replay.getByRole('slider', { name: 'Playback position', exact: true });
  await seek.fill('6');
  await expect(replay.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  await expect.poll(() => coloredPixels(panel.locator('canvas'))).toBe(0);
  await expect.poll(() => coloredPixels(panel.locator('canvas'), 'unknown')).toBe(0);
  await seek.fill('10');
  await expect.poll(() => coloredPixels(panel.locator('canvas'))).toBeGreaterThan(10);
  const oldCanvas = await panel.locator('canvas').elementHandle();
  await seek.fill('1');
  // Backward seeks deliberately remount the viewer; inspect the replacement canvas.
  await expect.poll(() => oldCanvas!.evaluate(element => element.isConnected)).toBe(false);
  await expect(panel.locator('canvas')).toBeVisible();
  await expect.poll(() => coloredPixels(panel.locator('canvas'))).toBeGreaterThan(10);
  await expect.poll(() => coloredPixels(panel.locator('canvas'), 'unknown')).toBeGreaterThan(10);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  while (await panel.locator('.visualization-options:not([open]) > summary').count()) {
    await panel.locator('.visualization-options:not([open]) > summary').first().click();
  }
  await expect(panel.locator('.visualization-status')).toHaveCount(0);
  expect(errors).toEqual([]);
});
