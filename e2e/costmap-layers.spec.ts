import { expect, test, type Locator, type Page } from '@playwright/test';
import { McapWriter, TempBuffer } from '@mcap/core';
import sharp from 'sharp';
import {
  getRosSubscriptionCount,
  getPublishedRosMessages,
  installRosMock,
  publishRosMessage,
  waitForRosSubscription,
} from './helpers/rosMock';
import { openLayerSettings } from './helpers/layerSettings';
const topic = '/global_costmap/costmap',
  updates = topic + '_updates';
const header = (sec = 0) => ({ frame_id: 'map', stamp: { sec, nanosec: 0 } });
const map = (sec = 0, x = -1) => ({
  header: header(sec),
  info: {
    width: 4,
    height: 4,
    resolution: 0.5,
    origin: { position: { x, y: -1, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  },
  data: Array(16).fill(0),
});
const patch = (sec = 1, extra: object = {}) => ({
  header: header(sec),
  x: 1,
  y: 1,
  width: 2,
  height: 2,
  data: [100, 100, 100, 100],
  ...extra,
});
async function settings(panel: Locator) {
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
}
async function addMap(page: Page) {
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await settings(panel);
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Occupancy grid (${topic})`, { exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Occupancy grid', topic);
  await panel.getByLabel(`Color scheme for Occupancy grid on ${topic}`).selectOption('costmap');
  await panel.getByLabel(`Updates topic for Occupancy grid on ${topic}`).selectOption(updates);
  return panel;
}
async function magenta(canvas: Locator) {
  const image = await canvas.screenshot();
  const { width, height } = await sharp(image).metadata();
  const { data, info } = await sharp(image)
    .extract({ left: 0, top: 55, width: width! - 80, height: height! - 55 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (data[i] > 150 && data[i + 2] > 150 && data[i + 1] < 80) count++;
  return count;
}
for (const theme of ['dark', 'light', 'solarized', 'custom-cobalt']) {
  test(`incremental costmaps recover, persist and fit the ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: theme === 'dark' ? 1280 : 390, height: 844 });
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
    await installRosMock(page, {
      controlMode: 'observer',
      topics: [
        { name: topic, type: 'nav_msgs/msg/OccupancyGrid' },
        { name: updates, type: 'map_msgs/msg/OccupancyGridUpdate' },
      ],
    });
    await page.goto('/');
    const connect = async () => {
      await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
      await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 15000 });
    };
    await connect();
    const panel = await addMap(page);
    await waitForRosSubscription(page, updates);
    const subscriptions = await getRosSubscriptionCount(page, topic);
    const popup = panel.locator('.settings-popup');
    await panel.getByLabel(`Updates topic for Occupancy grid on ${topic}`).scrollIntoViewIfNeeded();
    expect(await popup.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const select of await panel.locator('.layer-settings select').all())
      expect(await select.evaluate(el => getComputedStyle(el).fontFamily)).toBe(
        await popup.evaluate(el => getComputedStyle(el).fontFamily)
      );
    await page.screenshot({ path: testInfo.outputPath('costmap-settings.png') });
    await publishRosMessage(page, topic, map());
    await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect.poll(() => magenta(panel.locator('canvas'))).toBe(0);
    await publishRosMessage(page, updates, patch());
    await expect.poll(() => magenta(panel.locator('canvas'))).toBeGreaterThan(30);
    expect(await getRosSubscriptionCount(page, topic)).toBe(subscriptions);
    await publishRosMessage(page, updates, patch(2, { x: 4 }));
    await settings(panel);
    await expect(panel.getByRole('status')).toContainText('fresh full map');
    await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect.poll(() => magenta(panel.locator('canvas'))).toBe(0);
    await publishRosMessage(page, updates, patch(3));
    await expect.poll(() => magenta(panel.locator('canvas'))).toBe(0);
    await publishRosMessage(page, topic, map(4));
    await publishRosMessage(page, updates, patch(5));
    await expect.poll(() => magenta(panel.locator('canvas'))).toBeGreaterThan(30);
    await publishRosMessage(page, topic, {
      ...map(6),
      info: { ...map().info, width: 2, height: 2, resolution: 1 },
      data: [0, 0, 0, 0],
    });
    await expect.poll(() => magenta(panel.locator('canvas'))).toBe(0);
    await page.reload();
    await connect();
    await settings(panel);
    await openLayerSettings(panel, 'Occupancy grid', topic);
    await expect(panel.getByLabel(`Color scheme for Occupancy grid on ${topic}`)).toHaveValue('costmap');
    await expect(panel.getByLabel(`Updates topic for Occupancy grid on ${topic}`)).toHaveValue(updates);
    expect(await getPublishedRosMessages(page, '/cmd_vel')).toEqual([]);
    expect(await getPublishedRosMessages(page, topic)).toEqual([]);
    expect(await getPublishedRosMessages(page, updates)).toEqual([]);
  });
}

async function bag() {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: '', library: 'costmap-test' });
  for (const [name, type, messages] of [
    [
      topic,
      'nav_msgs/msg/OccupancyGrid',
      [
        [0, map()],
        [3, map(3)],
      ],
    ],
    [
      updates,
      'map_msgs/msg/OccupancyGridUpdate',
      [
        [1, patch()],
        [2, patch(2, { x: 0, y: 0 })],
        [4, patch(4)],
      ],
    ],
  ] as const) {
    const schemaId = await writer.registerSchema({
      name: type,
      encoding: 'jsonschema',
      data: new TextEncoder().encode('{}'),
    });
    const channelId = await writer.registerChannel({
      topic: name,
      schemaId,
      messageEncoding: 'json',
      metadata: new Map(),
    });
    for (const [sec, message] of messages) {
      const time = BigInt(sec) * 1_000_000_000n;
      await writer.addMessage({
        channelId,
        sequence: sec,
        logTime: time,
        publishTime: time,
        data: new TextEncoder().encode(JSON.stringify(message)),
      });
    }
  }
  await writer.end();
  return buffer.get();
}
test('reconstructs all recorded costmap patches after forward/backward seeks and late layer creation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open local recordings', exact: true }).click();
  const replay = page.getByRole('region', { name: 'Record & Replay', exact: true });
  await replay
    .getByLabel('Open MCAP recording')
    .setInputFiles({ name: 'costmap.mcap', mimeType: 'application/octet-stream', buffer: Buffer.from(await bag()) });
  await expect(replay.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  // Add the layer late, when a single cached update would be insufficient.
  await replay.getByRole('slider', { name: 'Playback position', exact: true }).fill('2.5');
  const panel = await addMap(page);
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  const canvas = panel.locator('canvas');
  await expect.poll(() => magenta(canvas)).toBeGreaterThan(30);
  const many = await magenta(canvas);
  await replay.getByRole('slider', { name: 'Playback position', exact: true }).fill('3.5');
  await expect.poll(() => magenta(canvas)).toBe(0);
  await replay.getByRole('slider', { name: 'Playback position', exact: true }).fill('4');
  await expect.poll(() => magenta(canvas)).toBeGreaterThan(30);
  const previousCanvas = await canvas.elementHandle();
  await replay.getByRole('slider', { name: 'Playback position', exact: true }).fill('1.5');
  await expect.poll(() => previousCanvas!.evaluate(el => el.isConnected)).toBe(false);
  await expect(canvas).toBeVisible();
  await expect.poll(() => magenta(canvas)).toBeGreaterThan(30);
  expect(await magenta(canvas)).toBeLessThan(many);
});
