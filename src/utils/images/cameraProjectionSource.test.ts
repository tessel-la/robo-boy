import { afterEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { subscribeToProjectionImages } from './cameraProjectionSource';
import { subscribeToImages } from './cameraStreams';
import { subscribeToMjpeg } from './mjpegStreams';
import { probeCameraSourceSize } from '../cameraStreamQuality';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import type { ImageEvent } from './sharedImageFrame';

vi.mock('./cameraStreams', () => ({ subscribeToImages: vi.fn(() => vi.fn()) }));
vi.mock('./mjpegStreams', () => ({ subscribeToMjpeg: vi.fn(() => vi.fn()) }));
vi.mock('../../features/recordReplay/ReplaySession', () => ({ isReplayRos: vi.fn(() => false) }));
vi.mock('../cameraStreamQuality', async importOriginal => ({
  ...(await importOriginal<typeof import('../cameraStreamQuality')>()),
  probeCameraSourceSize: vi.fn(async () => ({ width: 640, height: 480 })),
}));
const config = {
  ros: {} as Ros,
  topic: '/camera/image_raw',
  messageType: 'sensor_msgs/Image',
  baseUrl: '/video_stream',
  source: 'stream' as const,
  quality: 'medium' as const,
};
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('uses only recorded ROS messages during replay, without probing a live endpoint', () => {
  vi.mocked(isReplayRos).mockReturnValueOnce(true);
  const listener = vi.fn();
  const stop = subscribeToProjectionImages(config, listener);
  expect(subscribeToImages).toHaveBeenCalledWith(config.ros, config.topic, config.messageType, listener);
  expect(probeCameraSourceSize).not.toHaveBeenCalled();
  expect(subscribeToMjpeg).not.toHaveBeenCalled();
  stop();
});

it('does not create a stream if removed while the source size probe is pending', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  let complete!: (size: null) => void;
  vi.mocked(probeCameraSourceSize).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve;
    })
  );
  const stop = subscribeToProjectionImages(config, vi.fn());
  stop();
  complete(null);
  await flush();
  expect(subscribeToMjpeg).not.toHaveBeenCalled();
  expect(subscribeToImages).not.toHaveBeenCalled();
});

it('reports invalid cached metadata and detaches without subscribing to ROS', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  const stopVideo = vi.fn(),
    listener = vi.fn();
  let receive!: (event: ImageEvent) => void;
  vi.mocked(subscribeToMjpeg).mockImplementationOnce((_ros, _url, _base, callback) => {
    receive = callback;
    callback({ frame: { projectionError: 'missing metadata' } as ImageEvent['frame'], error: null });
    return stopVideo;
  });
  const stop = subscribeToProjectionImages(config, listener);
  await flush();
  expect(stopVideo).toHaveBeenCalledOnce();
  expect(subscribeToImages).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledWith({
    frame: null,
    error: expect.stringContaining('no valid ROS acquisition metadata'),
  });
  expect(listener.mock.lastCall![0].error).toContain('Select ROS image messages');
  receive({ frame: null, error: 'late transport error' });
  receive({ frame: { header: { frame_id: 'optical' } } as ImageEvent['frame'], error: null });
  expect(listener).toHaveBeenCalledOnce();
  stop();
  expect(stopVideo).toHaveBeenCalledOnce();
});

it('subscribes to exactly the chosen ROS topic when ROS messages are selected', () => {
  const listener = vi.fn();
  const stop = subscribeToProjectionImages({ ...config, source: 'ros' }, listener);
  expect(subscribeToImages).toHaveBeenCalledWith(config.ros, config.topic, config.messageType, listener);
  expect(probeCameraSourceSize).not.toHaveBeenCalled();
  expect(subscribeToMjpeg).not.toHaveBeenCalled();
  stop();
});

it('reports unsupported browser APIs without switching transports', () => {
  vi.stubGlobal('createImageBitmap', undefined);
  const listener = vi.fn();
  const stop = subscribeToProjectionImages(config, listener);
  expect(listener).toHaveBeenCalledWith({
    frame: null,
    error: expect.stringContaining('This browser cannot read timestamped camera streams'),
  });
  expect(subscribeToImages).not.toHaveBeenCalled();
  expect(subscribeToMjpeg).not.toHaveBeenCalled();
  stop();
});

it('reports transport failures without switching to ROS', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  const stopVideo = vi.fn(),
    listener = vi.fn();
  let receive!: (event: ImageEvent) => void;
  vi.mocked(subscribeToMjpeg).mockImplementationOnce((_ros, _url, _base, callback) => {
    receive = callback;
    return stopVideo;
  });
  const stop = subscribeToProjectionImages(config, listener);
  await flush();
  receive({ frame: null, error: 'HTTP 503' });
  await flush();
  expect(listener).toHaveBeenCalledWith({ frame: null, error: expect.stringContaining('HTTP 503') });
  expect(subscribeToImages).not.toHaveBeenCalled();
  expect(stopVideo).toHaveBeenCalledOnce();
  stop();
  expect(stopVideo).toHaveBeenCalledOnce();
});

it('samples only projection callbacks while keeping the shared stream subscribed', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  const now = vi.spyOn(performance, 'now');
  let receive!: (event: ImageEvent) => void;
  const stopVideo = vi.fn(),
    listener = vi.fn();
  vi.mocked(subscribeToMjpeg).mockImplementationOnce((_ros, _url, _base, callback) => {
    receive = callback;
    return stopVideo;
  });
  const stop = subscribeToProjectionImages(config, listener);
  await flush();
  for (let time = 0; time <= 300; time += 20) {
    now.mockReturnValue(time);
    receive({
      frame: { header: { frame_id: 'optical', stamp: { sec: 1, nanosec: 0 } } } as ImageEvent['frame'],
      error: null,
    });
  }
  expect(listener).toHaveBeenCalledTimes(4);
  expect(stopVideo).not.toHaveBeenCalled();
  expect(subscribeToImages).not.toHaveBeenCalled();
  stop();
  now.mockRestore();
  expect(stopVideo).toHaveBeenCalledOnce();
});
