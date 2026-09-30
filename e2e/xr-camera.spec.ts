import { createServer, type ServerResponse } from 'node:http';
import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

const pixel = (page: Page) =>
  page.evaluate(() => {
    const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-camera');
    const screen = panel?.getObjectByName('xr-camera-image') as
      | import('three').Mesh<import('three').BufferGeometry, import('three').MeshBasicMaterial>
      | undefined;
    const canvas = screen?.material.map?.image as HTMLCanvasElement | undefined;
    return canvas
      ? Array.from(canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data).slice(0, 3)
      : [];
  });
for (const mode of ['VR', 'AR'] as const) {
  test(`native camera in ${mode} updates MJPEG without opening a second stream`, async ({ page }) => {
    const frames = await Promise.all(
      ['#ff0000', '#00ff00'].map(background =>
        sharp({ create: { width: 320, height: 180, channels: 3, background } })
          .jpeg()
          .toBuffer()
      )
    );
    let currentFrame = 0,
      requests = 0;
    const streams = new Set<ServerResponse>();
    const server = createServer((_request, response) => {
      requests++;
      streams.add(response);
      response.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      const write = () => {
        const image = frames[currentFrame];
        response.write(
          Buffer.concat([
            Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${image.length}\r\n\r\n`),
            image,
            Buffer.from('\r\n'),
          ])
        );
      };
      write();
      const timer = setInterval(write, 50);
      response.on('close', () => {
        clearInterval(timer);
        streams.delete(response);
      });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    try {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.route('**/video_stream/**', route => route.continue({ url: `http://127.0.0.1:${port}/stream` }));
      await installXrEmulator(page);
      await installRosMock(page, {
        topics: ['/front/image', '/rear/image'].map(name => ({ name, type: 'sensor_msgs/msg/Image' })),
      });
      await page.addInitScript(() => {
        localStorage.setItem(
          'robo-boy-desktop-workspace-panels-v1',
          JSON.stringify([{ id: 'xr-camera', type: 'camera', title: 'Camera', cameraTopic: '/front/image' }])
        );
        localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-camera']));
      });
      await page.goto('/');
      await page.getByTitle('Advanced Options').click();
      await page.locator('#ros2Value').fill('127.0.0.1');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect
        .poll(() => page.locator('.camera-view img').evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBe(320);
      expect(streams.size).toBe(1);
      const beforeXr = requests;
      await observeXrScene(page);
      await page.getByRole('radio', { name: mode, exact: true }).click();
      await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
      await expect.poll(async () => (await pixel(page))[0]).toBeGreaterThan(240);
      expect(requests).toBe(beforeXr);
      expect(streams.size).toBe(1);
      currentFrame = 1;
      await expect.poll(async () => (await pixel(page))[1]).toBeGreaterThan(240);
      await pressXrControl(page, 'xr-camera', 'topics');
      await pressXrControl(page, 'xr-camera', 'row-1');
      await expect(page.locator('.camera-view select')).toHaveValue('/rear/image');
      await expect.poll(() => requests).toBe(beforeXr + 1);
      await expect.poll(() => streams.size).toBe(1);
      await saveXrPanelPreview(page, 'xr-camera', `/tmp/robo-boy-xr-camera-${mode.toLowerCase()}.png`);
      await pressXrControl(page, 'xr-camera', 'retry');
      await expect.poll(() => requests).toBe(beforeXr + 2);
      await expect.poll(async () => (await pixel(page))[1]).toBeGreaterThan(240);
      await page.evaluate(() => window.__xrSession.end());
      await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
      await expect(page.locator('.camera-view select')).toHaveValue('/rear/image');
      expect(streams.size).toBe(1);
      await page.getByRole('button', { name: 'Remove Camera', exact: true }).click();
      await expect.poll(() => streams.size).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      for (const response of streams) response.destroy();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
}

// The real replay worker decodes these raw images, and the camera tile remains its only consumer.
test('XR camera follows paused MCAP seeks and topic changes using the existing replay canvas', async ({ page }) => {
  const { McapWriter, TempBuffer } = await import('@mcap/core');
  const { parse } = await import('@foxglove/rosmsg');
  const { MessageWriter } = await import('@foxglove/rosmsg2-serialization');
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: '', library: 'xr-camera-test' });
  const definition = 'uint32 height\nuint32 width\nstring encoding\nuint8 is_bigendian\nuint32 step\nuint8[] data';
  const encode = new MessageWriter(parse(definition, { ros2: true }));
  const schemaId = await writer.registerSchema({
    name: 'sensor_msgs/msg/Image',
    encoding: 'ros2msg',
    data: new TextEncoder().encode(definition),
  });
  for (const topic of ['/front/image', '/rear/image']) {
    const channelId = await writer.registerChannel({ topic, schemaId, messageEncoding: 'cdr', metadata: new Map() });
    for (let i = 0; i <= 10; i++) {
      const color = topic === '/rear/image' ? [0, 0, 255] : i < 5 ? [255, 0, 0] : [0, 255, 0];
      const message = {
        width: 2,
        height: 1,
        encoding: 'rgb8',
        step: 6,
        data: new Uint8Array([...color, ...color]),
        is_bigendian: 0,
      };
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: BigInt(i) * 1_000_000_000n,
        publishTime: BigInt(i) * 1_000_000_000n,
        data: encode.writeMessage(message),
      });
    }
  }
  await writer.end();
  let liveStreams = 0;
  await page.route('**/video_stream/**', route => {
    liveStreams++;
    return route.abort();
  });
  await installXrEmulator(page);
  await installRosMock(page, { topics: [] });
  await page.addInitScript(() => {
    localStorage.setItem(
      'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([
        { id: 'xr-camera', type: 'camera', title: 'Camera', cameraTopic: '/front/image' },
        { id: 'recording', type: 'recordReplay', title: 'Record & Replay' },
      ])
    );
    localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-camera', 'recording']));
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const recorder = page.getByRole('region', { name: 'Record & Replay', exact: true });
  await recorder
    .getByLabel('Open MCAP recording')
    .setInputFiles({ name: 'cameras.mcap', mimeType: 'application/octet-stream', buffer: Buffer.from(buffer.get()) });
  await expect(page.getByLabel('Recorded camera topic')).toHaveValue('/front/image');
  await expect(page.locator('.recorded-camera-frame')).toBeVisible();
  await observeXrScene(page);
  await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
  await expect.poll(async () => (await pixel(page))[0]).toBe(255);
  // Drive the shared playback position while immersive; the recording panel's native controls are
  // a separate port. This test specifically verifies the camera consumes the real replay pipeline.
  await recorder.getByRole('slider', { name: 'Playback position' }).evaluate(el => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '8');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await pixel(page))[1]).toBe(255);
  await pressXrControl(page, 'xr-camera', 'topics');
  await pressXrControl(page, 'xr-camera', 'row-1');
  await expect(page.getByLabel('Recorded camera topic')).toHaveValue('/rear/image');
  await expect.poll(async () => (await pixel(page))[2]).toBe(255);
  expect(liveStreams).toBe(0);
  await page.evaluate(() => window.__xrSession.end());
  await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
  await expect(page.getByLabel('Recorded camera topic')).toHaveValue('/rear/image');
});
