import { createServer, type ServerResponse } from 'node:http';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

// A real, ongoing multipart response is essential: a fulfilled static image cannot reveal
// streams which survive after their panel has been removed.
test('refreshes late camera topics and releases MJPEG streams on refresh and removal', async ({ page }) => {
  const frame = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#123456' } })
    .jpeg()
    .toBuffer();
  const streams = new Set<ServerResponse>();
  let requests = 0;
  const server = createServer((_request, response) => {
    ++requests;
    streams.add(response);
    response.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store',
    });
    const writeFrame = () =>
      response.write(
        Buffer.concat([
          Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`),
          frame,
          Buffer.from('\r\n'),
        ])
      );
    writeFrame();
    const timer = setInterval(writeFrame, 50);
    response.on('close', () => {
      clearInterval(timer);
      streams.delete(response);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    await page.route('**/video_stream/**', route =>
      route.continue({
        url: `http://127.0.0.1:${address.port}/stream`,
      })
    );
    await installRosMock(page, {
      topics: [],
      serviceCalls: {
        '/rosapi/topics': [
          { values: { topics: [], types: [] } },
          {
            values: {
              topics: ['/camera/image_raw', '/camera/late'],
              types: ['sensor_msgs/Image', 'sensor_msgs/msg/Image'],
            },
          },
        ],
      },
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await page.getByLabel('Add workspace panel').first().click();
      await page.getByRole('button', { name: 'Camera', exact: true }).click();
      const image = page.locator('.camera-view img');
      if (cycle === 0) {
        await expect(image).toHaveCount(0);
        await page.getByRole('button', { name: 'Refresh camera topics and stream' }).click();
      }
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
      await expect.poll(() => streams.size).toBe(1);
      if (cycle === 0) {
        await page.getByLabel('Camera topic', { exact: true }).selectOption('/camera/late');
        await page.getByLabel('Stream quality', { exact: true }).selectOption('low');
        await expect(image).toHaveAttribute('src', /topic=\/camera\/late.*quality=40/);
        await expect.poll(() => streams.size).toBe(1);
        const before = requests;
        await page.getByRole('button', { name: 'Refresh camera topics and stream' }).click();
        await expect.poll(() => requests).toBeGreaterThan(before);
        await expect.poll(() => streams.size).toBe(1);
        await expect(page.getByLabel('Camera topic', { exact: true })).toHaveValue('/camera/late');
        await expect(page.getByLabel('Stream quality', { exact: true })).toHaveValue('low');
      }
      await page.getByRole('button', { name: 'Remove Camera', exact: true }).click();
      await expect(image).toHaveCount(0);
      await expect.poll(() => streams.size).toBe(0);
    }
    await expect(page.getByLabel('Add workspace panel').first()).toBeVisible();
  } finally {
    for (const response of streams) response.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
