import { afterEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { subscribeToWebRtcFrames } from './webrtcStreams';
import { subscribeToProjectionImages } from './cameraProjectionSource';
import { subscribeToImages, subscribeToCameraInfo } from './cameraStreams';
import { subscribeToMjpeg } from './mjpegStreams';
import { probeCameraSourceSize } from '../cameraStreamQuality';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import type { ImageEvent } from './sharedImageFrame';

vi.mock('./webrtcStreams', () => ({ subscribeToWebRtcFrames: vi.fn(() => vi.fn()) }));
vi.mock('./cameraStreams', () => ({
  subscribeToImages: vi.fn(() => vi.fn()),
  subscribeToCameraInfo: vi.fn(() => vi.fn()),
}));
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

it('projects standard MJPEG using explicitly selected latest TF and CameraInfo without metadata', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  const listener = vi.fn(),
    stopInfo = vi.fn();
  vi.mocked(subscribeToCameraInfo).mockImplementationOnce((_ros, _topic, receive) => {
    receive({ samples: [{ frame: 'optical' }] as any, error: null });
    return stopInfo;
  });
  let receive!: (event: ImageEvent) => void;
  vi.mocked(subscribeToMjpeg).mockImplementationOnce((_ros, _url, _base, callback) => {
    receive = callback;
    return vi.fn();
  });
  const stop = subscribeToProjectionImages(
    { ...config, videoTiming: 'latest', cameraInfoTopic: '/camera/camera_info' },
    listener
  );
  await flush();
  receive({ frame: { projectionError: 'No metadata', image: { width: 320, height: 240 } } as any, error: null });
  expect(listener.mock.lastCall![0].frame.header).toEqual({ frame_id: 'optical', stamp: { sec: 0, nanosec: 0 } });
  expect(listener.mock.lastCall![0].frame.projectionError).toBeUndefined();
  expect(listener.mock.lastCall![0].frame.sourceSize).toEqual({ width: 640, height: 480 });
  expect(subscribeToImages).not.toHaveBeenCalled();
  stop();
  expect(stopInfo).toHaveBeenCalledOnce();
});

it('maps ordinary WebRTC frames to explicitly selected calibration without metadata or MJPEG requests', () => {
  const listener = vi.fn(),
    stopInfo = vi.fn();
  vi.mocked(subscribeToCameraInfo).mockImplementationOnce((_ros, _topic, receive) => {
    receive({ samples: [{ frame: 'selected_optical' }] as any, error: null });
    return stopInfo;
  });
  let receive!: (event: ImageEvent) => void;
  vi.mocked(subscribeToWebRtcFrames).mockImplementationOnce((_ros, _url, callback) => {
    receive = callback;
    return vi.fn();
  });
  const stop = subscribeToProjectionImages(
    { ...config, source: 'webrtc', whepUrl: 'https://camera.example/whep', cameraInfoTopic: '/camera/camera_info' },
    listener
  );
  receive({ frame: { image: { width: 640, height: 480 } } as any, error: null });
  expect(listener.mock.lastCall![0].frame.header).toEqual({
    frame_id: 'selected_optical',
    stamp: { sec: 0, nanosec: 0 },
  });
  expect(probeCameraSourceSize).not.toHaveBeenCalled();
  expect(subscribeToMjpeg).not.toHaveBeenCalled();
  expect(subscribeToImages).not.toHaveBeenCalled();
  stop();
  expect(stopInfo).toHaveBeenCalledOnce();
});
it('replay bypasses saved WebRTC settings without contacting the stream', () => {
  vi.mocked(isReplayRos).mockReturnValueOnce(true);
  const stop = subscribeToProjectionImages(
    { ...config, source: 'webrtc', whepUrl: 'https://camera.example/whep' },
    vi.fn()
  );
  expect(subscribeToImages).toHaveBeenCalledOnce();
  expect(subscribeToWebRtcFrames).not.toHaveBeenCalled();
  stop();
});

it('can follow the MJPEG source rate without affecting the shared subscription', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  const now = vi.spyOn(performance, 'now');
  let receive!: (event: ImageEvent) => void;
  vi.mocked(subscribeToMjpeg).mockImplementationOnce((_ros, _url, _base, callback) => {
    receive = callback;
    return vi.fn();
  });
  const listener = vi.fn(),
    stop = subscribeToProjectionImages({ ...config, projectionFps: 0 }, listener);
  await flush();
  for (let time = 0; time <= 300; time += 20) {
    now.mockReturnValue(time);
    receive({ frame: { header: { frame_id: 'optical', stamp: { sec: 1, nanosec: 0 } } } as any, error: null });
  }
  expect(listener).toHaveBeenCalledTimes(16);
  expect(subscribeToMjpeg).toHaveBeenCalledOnce();
  stop();
  now.mockRestore();
});
