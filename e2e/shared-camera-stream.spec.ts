import { createServer, type ServerResponse } from 'node:http';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import {
  getActiveRosSubscriptionCount,
  installRosMock,
  publishRosMessage,
  waitForRosSubscription,
} from './helpers/rosMock';

const topic = '/front/image_raw';
const header = { frame_id: 'optical', stamp: { sec: 12345, nanosec: 678901234 } };

test('shares full-rate Camera frames with calibrated 3D, independently of TF and consumer lifetime', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#ff2020' } })
    .jpeg()
    .toBuffer();
  const id = Buffer.from(header.frame_id);
  const marker = Buffer.alloc(28 + id.length);
  marker.set([0xff, 0xef]);
  marker.writeUInt16BE(26 + id.length, 2);
  marker.write('RBROS001', 4);
  marker.writeUInt32BE(header.stamp.sec, 12);
  marker.writeUInt32BE(header.stamp.nanosec, 16);
  marker.writeUInt32BE(640, 20);
  marker.writeUInt32BE(480, 24);
  id.copy(marker, 28);
  const frame = Buffer.concat([jpeg.subarray(0, 2), marker, jpeg.subarray(2)]);
  const part = Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`),
    frame,
    Buffer.from('\r\n'),
  ]);
  const streams = new Set<ServerResponse>();
  let bytes = 0,
    requests = 0;
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url?.startsWith('/snapshot')) {
      response.writeHead(200, { 'Content-Type': 'image/jpeg' });
      response.end(frame);
      return;
    }
    requests++;
    streams.add(response);
    response.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store',
    });
    const send = () => {
      bytes += part.length;
      response.write(part);
    };
    send();
    const timer = setInterval(send, 1000 / 30);
    response.on('close', () => {
      clearInterval(timer);
      streams.delete(response);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/video_stream/**', route => {
      const path = new URL(route.request().url());
      return route.continue({
        url: `http://127.0.0.1:${port}/${path.pathname.endsWith('/snapshot') ? 'snapshot' : 'stream'}${path.search}`,
      });
    });
    await page.addInitScript(() => {
      const counters = { decoded: 0, drawn: 0 };
      (window as any).__cameraCounters = counters;
      const decode = window.createImageBitmap.bind(window);
      window.createImageBitmap = (async (...args: any[]) => {
        counters.decoded++;
        return (decode as any)(...args);
      }) as typeof createImageBitmap;
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
        if (this.canvas.classList.contains('shared-camera-frame')) counters.drawn++;
        return (draw as any).apply(this, args);
      };
    });
    await installRosMock(page, {
      topics: [
        { name: topic, type: 'sensor_msgs/msg/Image' },
        { name: `${topic}/compressed`, type: 'sensor_msgs/msg/CompressedImage' },
        { name: '/front/camera_info', type: 'sensor_msgs/msg/CameraInfo' },
        { name: '/tf_static', type: 'tf2_msgs/msg/TFMessage' },
      ],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();

    const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined;
    await cdp?.send('Performance.enable');
    const taskTime = async () => {
      const result = await cdp?.send('Performance.getMetrics');
      return result?.metrics.find((metric: { name: string }) => metric.name === 'TaskDuration')?.value ?? 0;
    };
    const sample = async (mode: string) => {
      const before = {
        bytes,
        task: await taskTime(),
        counters: await page.evaluate(() => ({ ...(window as any).__cameraCounters })),
        time: Date.now(),
      };
      // Fixed measurement window, including actual network/decode/draw work.
      await page.waitForTimeout(3000);
      const elapsed = (Date.now() - before.time) / 1000;
      const counters = await page.evaluate(() => (window as any).__cameraCounters);
      const result = {
        mode,
        seconds: elapsed,
        activeStreams: streams.size,
        bytesPerSecond: Math.round((bytes - before.bytes) / elapsed),
        decodedFps: (counters.decoded - before.counters.decoded) / elapsed,
        cameraDrawFps: (counters.drawn - before.counters.drawn) / elapsed,
        mainThreadMsPerSecond: cdp ? (((await taskTime()) - before.task) * 1000) / elapsed : undefined,
      };
      console.log('CAMERA_STREAM_MEASUREMENT', JSON.stringify(result));
      return result;
    };
    // Native MJPEG baseline on the same page, with the same source and HTTP fixture.
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.id = 'native-camera-baseline';
      image.src = '/video_stream/stream?topic=/front/image_raw&type=mjpeg&quality=60';
      image.style.cssText = 'position:fixed;top:0;left:0;width:640px;height:480px;z-index:99999';
      document.body.appendChild(image);
    });
    await expect.poll(() => streams.size).toBe(1);
    await sample('native-camera');
    await page.locator('#native-camera-baseline').evaluate(image => {
      image.removeAttribute('src');
      image.remove();
    });
    await expect.poll(() => streams.size).toBe(0);

    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByLabel('Stream quality', { exact: true }).selectOption('medium');
    const camera = page.locator('.camera-view canvas');
    await expect(camera).toBeVisible();
    await expect.poll(() => streams.size).toBe(1);
    const alone = await sample('shared-camera');
    expect(alone.cameraDrawFps).toBeGreaterThan(20);

    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: '3D panel', exact: true }).click();
    const panel = page.locator('.visualization-panel');
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByRole('tab', { name: /^Visualizations/ }).click();
    await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByTitle(`Add Camera image (${topic}/compressed)`, { exact: true }).click();
    await panel.getByRole('tab', { name: /^Visualizations/ }).click();
    await panel.locator('[id^="visualization-topic-"]').selectOption(topic);
    await expect(panel.getByLabel(`Image source for Camera image on ${topic}`)).toHaveValue('stream');
    await panel.getByLabel(`TF timing for Camera image on ${topic}`).selectOption('capture');
    await expect.poll(() => getActiveRosSubscriptionCount(page, topic)).toBe(0);
    await expect.poll(() => getActiveRosSubscriptionCount(page, `${topic}/compressed`)).toBe(0);
    await expect.poll(() => streams.size).toBe(1);
    await expect(panel.getByRole('status').filter({ hasText: 'CameraInfo' })).toBeVisible();
    const waiting = await sample('camera-and-3d-waiting');
    expect(waiting.cameraDrawFps).toBeGreaterThan(20);
    expect(waiting.decodedFps).toBeLessThan(40); // One decoder, not one for each consumer.

    await waitForRosSubscription(page, '/front/camera_info');
    await waitForRosSubscription(page, '/tf_static');
    await publishRosMessage(page, '/front/camera_info', {
      header: { ...header, stamp: { sec: 0, nanosec: 0 } },
      width: 640,
      height: 480,
      distortion_model: 'plumb_bob',
      d: [0, 0, 0, 0, 0],
      k: [640, 0, 320, 0, 640, 240, 0, 0, 1],
      p: [640, 0, 320, 0, 0, 640, 240, 0, 0, 0, 1, 0],
    });
    await publishRosMessage(page, '/tf_static', {
      transforms: [
        {
          header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
          child_frame_id: 'optical',
          transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      ],
    });
    await expect(panel.getByRole('status').filter({ hasText: /Waiting|fallback|invalid/ })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect
      .poll(async () => {
        const { data, info } = await sharp(await panel.locator('canvas').screenshot())
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let red = 0;
        for (let i = 0; i < data.length; i += info.channels) if (data[i] > 150 && data[i] > data[i + 1] * 2) red++;
        return red;
      })
      .toBeGreaterThan(30);
    const together = await sample('camera-and-3d-rendering');
    expect(together.cameraDrawFps).toBeGreaterThan(20);
    expect(together.decodedFps).toBeLessThan(40);

    const beforeRefresh = requests;
    await page.getByRole('button', { name: 'Refresh camera topics and stream' }).click();
    await expect.poll(() => requests).toBeGreaterThan(beforeRefresh);
    await expect.poll(() => streams.size).toBe(1);
    // Camera can leave while 3D retains its source; adding Camera back attaches to it.
    await page.getByRole('button', { name: 'Remove Camera', exact: true }).click();
    await expect.poll(() => streams.size).toBe(1);
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByLabel('Stream quality', { exact: true }).selectOption('medium');
    await expect(camera).toBeVisible();
    await expect.poll(() => streams.size).toBe(1);
    await page.getByLabel('Stream quality', { exact: true }).selectOption('low');
    await expect.poll(() => streams.size).toBe(2);
    await page.getByLabel('Stream quality', { exact: true }).selectOption('medium');
    await expect.poll(() => streams.size).toBe(1);
    await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
    await expect(camera).toBeVisible();
    await expect.poll(() => streams.size).toBe(1);
    await page.getByRole('button', { name: 'Remove Camera', exact: true }).click();
    await expect.poll(() => streams.size).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    for (const response of streams) response.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
