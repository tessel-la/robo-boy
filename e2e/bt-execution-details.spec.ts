import { expect, test, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { installRosMock } from './helpers/rosMock';

/** A small gradient, as the RGB bytes of a sensor_msgs/Image and as a PNG file. */
const WIDTH = 64;
const HEIGHT = 40;
const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const i = (y * WIDTH + x) * 3;
    rgb[i] = Math.round((x / WIDTH) * 255);
    rgb[i + 1] = Math.round((y / HEIGHT) * 255);
    rgb[i + 2] = 160;
  }
}

function png(): string {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: HEIGHT }, (_, y) => Buffer.concat([Buffer.from([0]), rgb.subarray(y * WIDTH * 3, (y + 1) * WIDTH * 3)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const CAPTURED = { header: { frame_id: 'camera' }, format: 'png', data: png() };
const SNAPSHOT = { success: true, frame: { header: { frame_id: 'camera' }, height: HEIGHT, width: WIDTH, encoding: 'rgb8', is_bigendian: 0, step: WIDTH * 3, data: rgb.toString('base64') } };

async function seedTree(page: Page) {
  await page.evaluate(() => {
    const now = Date.now();
    const action = (id: string, label: string, actionName: string, x: number) => ({
      id, type: 'action', position: { x, y: 220 },
      data: { label, actionName, actionType: 'robot_msgs/action/Task', parameters: { run: true }, timeout: 10000 },
    });
    const tree = {
      id: 'e2e-inspection',
      name: 'Inspection',
      nodes: [
        { id: 'node-0', type: 'sequence', position: { x: 260, y: 0 }, data: { label: 'Inspect', type: 'sequence' } },
        action('node-1', 'Capture', '/camera/capture', 0),
        { id: 'node-2', type: 'service', position: { x: 260, y: 220 }, data: { label: 'Snapshot', serviceName: '/camera/snapshot', serviceType: 'robot_msgs/srv/Snapshot', timeout: 5000 } },
        action('node-3', 'Dock', '/dock', 520),
      ],
      edges: ['node-1', 'node-2', 'node-3'].map(target => ({ id: `edge-${target}`, source: 'node-0', target, animated: true })),
      createdAt: now,
      updatedAt: now,
    };
    localStorage.setItem('robo-boy-behavior-trees', JSON.stringify([{ tree, version: '1.0.0' }]));
  });
}

const node = (page: Page, label: string) => page.locator('.bt-node').filter({ has: page.locator('.bt-node-label', { hasText: new RegExp(`^${label}$`) }) });
const chip = (page: Page, label: string) => node(page, label).locator('.bt-exec-chip');

test('action and service results, feedback, images and failures can be inspected from the tree, and never outlive their run', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await installRosMock(page, {
    actionGoals: {
      '/camera/capture': [
        { feedback: [{ stage: 'focusing', progress: 0.3 }, { stage: 'exposing', progress: 0.8 }], values: { image: CAPTURED, exposure_ms: 12 } },
        // The second run: the camera is slow, then fails.
        { delayMs: 1500, status: 6, values: { error_code: 7, error_msg: 'Lens cover closed' } },
      ],
      '/dock': [{ status: 6, values: { error_code: 104, error_msg: 'Dock not found', diagnostics: { search_radius_m: 2.5, candidates: [] } } }],
    },
    serviceCalls: {
      '/camera/snapshot': [{ values: SNAPSHOT }],
    },
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  await seedTree(page);
  await page.getByTestId('bt-menu-button').click();
  await page.locator('.bt-menu-tree-row').filter({ hasText: 'Inspection' }).click();
  await expect(node(page, 'Dock')).toHaveCount(1);
  await expect(page.locator('.bt-exec-chip')).toHaveCount(0);

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(chip(page, 'Dock')).toHaveClass(/tone-error/);
  await expect(chip(page, 'Capture')).toHaveClass(/tone-success/);
  await expect(chip(page, 'Snapshot')).toHaveClass(/tone-success/);

  // The action's image, feedback and result.
  await chip(page, 'Capture').click();
  let card = page.getByRole('dialog', { name: 'Capture execution details' });
  await expect(card).toContainText('Action · Succeeded');
  await expect(card.getByRole('region', { name: 'Feedback' })).toContainText('Latest of 2');
  await expect(card.getByRole('progressbar', { name: 'progress' })).toHaveAttribute('aria-valuenow', '80');
  const captured = card.getByRole('img', { name: 'image' });
  await expect(captured).toBeVisible();
  expect(await captured.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([WIDTH, HEIGHT]);
  await card.getByRole('button', { name: 'Enlarge image' }).click();
  const enlarged = page.getByRole('dialog', { name: 'image' });
  await expect(enlarged.getByRole('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(enlarged).toHaveCount(0);
  await expect(card).toBeVisible();

  // The service's raw image, decoded; the card follows the chip that was clicked.
  await chip(page, 'Snapshot').click();
  card = page.getByRole('dialog', { name: 'Snapshot execution details' });
  await expect(card).toContainText('Service · Responded');
  await expect(card.getByText(`${WIDTH}×${HEIGHT} · rgb8`)).toBeVisible();
  const frame = card.getByRole('img', { name: 'frame' });
  expect(await frame.evaluate((image: HTMLImageElement) => image.decode().then(() => [image.naturalWidth, image.naturalHeight]))).toEqual([WIDTH, HEIGHT]);

  // The failed action explains itself.
  await chip(page, 'Dock').click();
  card = page.getByRole('dialog', { name: 'Dock execution details' });
  await expect(card).toContainText('Action · Aborted');
  await expect(card.getByRole('region', { name: 'What went wrong' })).toContainText('Dock not found');
  await expect(card.getByRole('region', { name: 'What went wrong' })).toContainText('Code 104');
  await expect(card.getByRole('region', { name: 'Result' })).toContainText('search_radius_m:2.5');

  // The card never pushes the tree's layout around, and the node stays compact.
  const dockBox = await node(page, 'Dock').boundingBox();
  expect(dockBox!.width).toBeLessThanOrEqual(210);

  // Running again: nothing from the first run is shown while the second one works.
  await page.getByRole('button', { name: 'Close execution details' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(node(page, 'Capture')).toHaveClass(/status-running/);
  await expect(page.locator('.bt-exec-chip')).toHaveCount(0);
  await expect(chip(page, 'Capture')).toHaveClass(/tone-error/, { timeout: 5000 });
  await chip(page, 'Capture').click();
  card = page.getByRole('dialog', { name: 'Capture execution details' });
  await expect(card.getByRole('region', { name: 'What went wrong' })).toContainText('Lens cover closed');
  await expect(card.getByRole('img')).toHaveCount(0);
  // The sequence stopped at the capture: the later nodes did not run this time, and show nothing from before.
  await expect(chip(page, 'Snapshot')).toHaveCount(0);
  await expect(chip(page, 'Dock')).toHaveCount(0);
});

test('the details card is a bottom sheet on a phone and keeps its content inside the screen', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  const long = 'x'.repeat(3000);
  await installRosMock(page, {
    actionGoals: {
      '/camera/capture': [{ values: { note: long, samples: Array.from({ length: 500 }, (_, i) => ({ i, value: i / 10 })), image: CAPTURED } }],
      '/dock': [{ values: {} }],
    },
    serviceCalls: { '/camera/snapshot': [{ values: {} }] },
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  await seedTree(page);
  await page.getByTestId('bt-menu-button').click();
  await page.locator('.bt-menu-tree-row').filter({ hasText: 'Inspection' }).click();
  await page.getByRole('button', { name: 'Run' }).click();

  // Empty results give nothing to open.
  await expect(chip(page, 'Capture')).toBeVisible();
  await expect(node(page, 'Dock')).toHaveClass(/status-success/);
  await expect(chip(page, 'Dock')).toHaveCount(0);
  await expect(chip(page, 'Snapshot')).toHaveCount(0);

  await chip(page, 'Capture').click();
  const card = page.getByRole('dialog', { name: 'Capture execution details' });
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(box.height).toBeLessThan(844 * 0.75);
  await expect(card.getByRole('button', { name: 'Show all 3,000 characters' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Show 40 more of 460' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
