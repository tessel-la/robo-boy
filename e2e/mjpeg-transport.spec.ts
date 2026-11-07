import { createServer, type ServerResponse } from 'node:http';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';

test('reads shared camera frames in WebKit without breaking native MJPEG playback', async ({ page }) => {
  const jpeg = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#e02020' } })
    .jpeg()
    .toBuffer();
  const part = Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
    jpeg,
    Buffer.from('\r\n'),
  ]);
  const streams = new Set<ServerResponse>();
  const accepts: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    const accept = request.headers.accept ?? '';
    accepts.push(accept);
    const type = accept === 'multipart/mixed' ? 'multipart/mixed' : 'multipart/x-mixed-replace';
    response.writeHead(200, { 'Content-Type': `${type}; boundary=frame`, Vary: 'Accept' });
    streams.add(response);
    response.write(part);
    const timer = setInterval(() => response.write(part), 50);
    response.on('close', () => {
      clearInterval(timer);
      streams.delete(response);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await page.goto('/');
    const frames = await page.evaluate(async baseUrl => {
      const path = '/src/utils/images/mjpegStreams.ts';
      const { subscribeToMjpeg } = await import(/* @vite-ignore */ path);
      const ros = {};
      const url = `${baseUrl}/stream?topic=/camera/image_raw&type=mjpeg`;
      const counts = [0, 0];
      const images: ImageBitmap[] = [];
      const stops: (() => void)[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('No readable camera frames')), 5000);
          for (let i = 0; i < 2; i++)
            stops.push(
              subscribeToMjpeg(ros, url, baseUrl, (event: any) => {
                if (event.error) {
                  clearTimeout(timeout);
                  reject(new Error(event.error));
                }
                if (!event.frame) return;
                counts[i]++;
                images[i] = event.frame.image;
                if (counts.every(count => count >= 3)) {
                  clearTimeout(timeout);
                  resolve();
                }
              })
            );
        });
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 12;
        const context = canvas.getContext('2d')!;
        context.drawImage(images[0], 0, 0);
        return {
          shared: images[0] === images[1],
          size: [images[0].width, images[0].height],
          pixel: [...context.getImageData(0, 0, 1, 1).data],
        };
      } finally {
        stops.forEach(stop => stop());
      }
    }, baseUrl);
    expect(frames.shared).toBe(true);
    expect(frames.size).toEqual([16, 12]);
    expect(frames.pixel[0]).toBeGreaterThan(180);
    expect(frames.pixel[1]).toBeLessThan(60);
    expect(accepts).toEqual(['multipart/mixed']);
    await expect.poll(() => streams.size).toBe(0);

    // Native fallback uses the original wire format and remains displayable.
    await page.evaluate(baseUrl => {
      const image = document.createElement('img');
      image.id = 'native-mjpeg';
      image.src = `${baseUrl}/stream?topic=/camera/image_raw&type=mjpeg`;
      document.body.append(image);
    }, baseUrl);
    await expect
      .poll(() => page.locator('#native-mjpeg').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(16);
    expect(accepts).toHaveLength(2);
    expect(accepts[1]).not.toBe('multipart/mixed');
    await page.goto('about:blank');
    await expect.poll(() => streams.size).toBe(0);
  } finally {
    for (const response of streams) response.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
