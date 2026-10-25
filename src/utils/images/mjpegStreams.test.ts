import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { MjpegParser } from './mjpegParser';
import { jpegMetadata } from './jpegMetadata';
import { subscribeToMjpeg } from './mjpegStreams';

const header = { frame_id: 'camera_optical', stamp: { sec: 1792928097, nanosec: 123456789 } };
function jpeg(withMetadata = true) {
  const frame = new TextEncoder().encode(header.frame_id);
  const app = new Uint8Array(28 + frame.length);
  app.set([0xff, 0xef, 0, 26 + frame.length]);
  app.set(new TextEncoder().encode('RBROS001'), 4);
  const v = new DataView(app.buffer);
  v.setUint32(12, header.stamp.sec);
  v.setUint32(16, header.stamp.nanosec);
  v.setUint32(20, 1280);
  v.setUint32(24, 720);
  app.set(frame, 28);
  // Dimensions are validated before the mocked browser decoder is entered.
  return new Uint8Array([
    0xff,
    0xd8,
    ...(withMetadata ? app : []),
    0xff,
    0xc0,
    0,
    11,
    8,
    0,
    2,
    0,
    2,
    1,
    1,
    0x11,
    0,
    0xff,
    0xd9,
  ]);
}
function part(bytes = jpeg(), extra = '') {
  const headers = new TextEncoder().encode(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\nX-Timestamp: 42.000\r\n${extra}\r\n`
  );
  const result = new Uint8Array(headers.length + bytes.length + 2);
  result.set(headers);
  result.set(bytes, headers.length);
  result.set([13, 10], result.length - 2);
  return result;
}
const ros = {} as Ros;
const url = '/video_stream/stream?topic=/camera/image_raw&type=mjpeg&quality=60';
let controllers: ReadableStreamDefaultController<Uint8Array>[];
let aborts: ReturnType<typeof vi.fn>[];
let stops: (() => void)[];
const bitmap = () => ({ width: 2, height: 2, close: vi.fn() }) as unknown as ImageBitmap;
beforeEach(() => {
  vi.useFakeTimers();
  controllers = [];
  aborts = [];
  stops = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap())
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      const abort = vi.fn();
      aborts.push(abort);
      options.signal?.addEventListener('abort', abort);
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controllers.push(c);
        },
        cancel: abort,
      });
      return new Response(body, { headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' } });
    })
  );
});
afterEach(() => {
  stops.forEach(stop => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const flush = () => vi.advanceTimersByTimeAsync(5);
const subscribe = (listener = vi.fn(), source = ros, src = url) => {
  const stop = subscribeToMjpeg(source, src, '/video_stream', listener);
  stops.push(stop);
  return stop;
};

it('parses arbitrary network splits, embedded boundaries and large payloads with bounded headers', () => {
  const received: Uint8Array[] = [];
  const parser = new MjpegParser('multipart/x-mixed-replace; boundary="frame"', frame => received.push(frame));
  const bytes = part();
  for (const byte of bytes) parser.push(new Uint8Array([byte]));
  expect(received).toEqual([jpeg()]);
  const large = new Uint8Array(2 * 1024 * 1024);
  large.set(new TextEncoder().encode('--frame\r\n'), 16384);
  const wire = part(large);
  for (let i = 0; i < wire.length; i += 3333) parser.push(wire.subarray(i, i + 3333));
  expect(received[1].length).toBe(large.length);
  expect(received[1].every((value, i) => value === large[i])).toBe(true);
  expect(() => new MjpegParser('image/jpeg', () => {})).toThrow('boundary');
  expect(() => new MjpegParser('multipart/x-mixed-replace;boundary=f', () => {}).push(new Uint8Array(9000))).toThrow(
    'limit'
  );
  expect(() =>
    new MjpegParser('multipart/x-mixed-replace;boundary=frame', () => {}).push(part(jpeg(), 'Content-Length: 1\r\n'))
  ).toThrow('Content-Length');
  const huge = new TextEncoder().encode('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 999999999\r\n\r\n');
  expect(() => new MjpegParser('multipart/x-mixed-replace;boundary=frame', () => {}).push(huge)).toThrow('limit');
});

it('uses original ROS nanoseconds and source geometry, never the multipart receipt timestamp', () => {
  expect(jpegMetadata(jpeg())).toEqual({ header, sourceSize: { width: 1280, height: 720 } });
  expect(jpegMetadata(jpeg(false))).toEqual({ projectionError: expect.stringContaining('no ROS acquisition') });
  const invalid = jpeg();
  new DataView(invalid.buffer).setUint32(18, 1_000_000_000);
  expect(() => jpegMetadata(invalid)).toThrow('invalid');
  const truncated = jpeg().slice(0, 15);
  expect(() => jpegMetadata(truncated)).toThrow('truncated');
});

it('shares one full-rate reader/decoder, retaining bitmaps independently of TF/consumer lifetime', async () => {
  const a = vi.fn(),
    b = vi.fn();
  const stopA = subscribe(a),
    stopB = subscribe(b, ros, '/video_stream/stream?quality=60&type=mjpeg&topic=/camera/image_raw');
  await flush();
  expect(fetch).toHaveBeenCalledOnce();
  controllers[0].enqueue(part());
  await flush();
  const first = a.mock.lastCall![0].frame;
  const release = first.retain();
  expect(first).toBe(b.mock.lastCall![0].frame);
  for (let i = 0; i < 15; i++) {
    controllers[0].enqueue(part());
    await vi.advanceTimersByTimeAsync(20);
  }
  // Sixteen frames in 300 ms proves the shared source is not capped at the projection's 10 fps.
  expect(createImageBitmap).toHaveBeenCalledTimes(16);
  expect(a).toHaveBeenCalledTimes(17);
  expect(b).toHaveBeenCalledTimes(17);
  expect(first.image.close).not.toHaveBeenCalled();
  release();
  release();
  expect(first.image.close).toHaveBeenCalledOnce();
  stopA();
  expect(aborts[0]).not.toHaveBeenCalled();
  const last = b.mock.lastCall![0].frame;
  stopB();
  expect(aborts[0]).toHaveBeenCalled();
  expect(last.image.close).toHaveBeenCalledOnce();
});

it('isolates robots and quality profiles, refreshing compatible consumers together', async () => {
  subscribe();
  subscribe(vi.fn(), {} as Ros);
  subscribe(vi.fn(), ros, url.replace('60', '40'));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(3);
  subscribe(vi.fn(), ros, `${url}&_refresh=retry`);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(aborts[0]).toHaveBeenCalled();
  subscribe();
  await flush();
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('keeps only one in-flight decode and the newest pending frame, closing late results after disposal', async () => {
  const complete: ((frame: ImageBitmap) => void)[] = [];
  vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => complete.push(resolve)));
  const listener = vi.fn();
  const stop = subscribe(listener);
  await flush();
  controllers[0].enqueue(part());
  await flush();
  for (let i = 0; i < 20; i++) controllers[0].enqueue(part());
  await flush();
  expect(complete).toHaveLength(1);
  const first = bitmap();
  complete[0](first);
  await flush();
  expect(complete).toHaveLength(2);
  stop();
  const late = bitmap();
  complete[1](late);
  await flush();
  expect(late.close).toHaveBeenCalledOnce();
  expect(first.close).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledTimes(2);
});

it('never resurrects a failed stream from an in-flight decode and times out idle readers', async () => {
  let complete: (frame: ImageBitmap) => void = () => {};
  vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => (complete = resolve)));
  const listener = vi.fn();
  subscribe(listener);
  await flush();
  controllers[0].enqueue(part());
  await flush();
  controllers[0].error(new Error('connection lost'));
  await flush();
  expect(listener.mock.lastCall![0].error).toBe('connection lost');
  const late = bitmap();
  complete(late);
  await flush();
  expect(late.close).toHaveBeenCalledOnce();
  expect(listener.mock.lastCall![0].frame).toBeNull();
  const idle = vi.fn();
  subscribe(idle, {} as Ros);
  await vi.advanceTimersByTimeAsync(10001);
  expect(idle.mock.lastCall![0].error).toContain('timed out');
});

it('rejects destinations outside the configured camera endpoint before issuing a request', () => {
  expect(() => subscribe(vi.fn(), ros, 'https://other.example/stream?topic=/camera/image_raw')).toThrow('URL');
  expect(fetch).not.toHaveBeenCalled();
});
