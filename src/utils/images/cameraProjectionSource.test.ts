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
  fallbackTopic: '/camera/image_raw/compressed',
  fallbackType: 'sensor_msgs/CompressedImage',
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
  const stop = subscribeToProjectionImages(config, listener, vi.fn());
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
  const stop = subscribeToProjectionImages(config, vi.fn(), vi.fn());
  stop();
  complete(null);
  await flush();
  expect(subscribeToMjpeg).not.toHaveBeenCalled();
  expect(subscribeToImages).not.toHaveBeenCalled();
});

it('releases a synchronously cached legacy stream and falls back to the discovered compressed ROS topic once', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  const stopVideo = vi.fn(),
    stopRos = vi.fn(),
    listener = vi.fn(),
    status = vi.fn();
  let receive!: (event: ImageEvent) => void;
  vi.mocked(subscribeToMjpeg).mockImplementationOnce((_ros, _url, _base, callback) => {
    receive = callback;
    callback({ frame: { projectionError: 'missing metadata' } as ImageEvent['frame'], error: null });
    return stopVideo;
  });
  vi.mocked(subscribeToImages).mockReturnValueOnce(stopRos);
  const stop = subscribeToProjectionImages(config, listener, status);
  await flush();
  expect(stopVideo).toHaveBeenCalledOnce();
  expect(subscribeToImages).toHaveBeenCalledWith(
    config.ros,
    config.fallbackTopic,
    config.fallbackType,
    expect.any(Function)
  );
  expect(status).toHaveBeenCalledWith(expect.stringContaining('no valid ROS acquisition metadata'));
  receive({ frame: null, error: 'late transport error' });
  expect(subscribeToImages).toHaveBeenCalledOnce();
  expect(listener).not.toHaveBeenCalled();
  stop();
  expect(stopRos).toHaveBeenCalledOnce();
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
  const stop = subscribeToProjectionImages(config, listener, vi.fn());
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
