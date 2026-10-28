import { afterEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { requestCameraCapture } from './cameraCapture';
import { executeRosOperation } from '../rosOperations';
import type { CameraCaptureOptions } from './cameraImageOptions';
const state = vi.hoisted(() => ({ replay: false, receive: (_message: unknown) => {}, unsubscribe: vi.fn() }));
vi.mock('../../features/recordReplay/ReplaySession', () => ({ isReplayRos: () => state.replay }));
vi.mock('../rosOperations', () => ({ executeRosOperation: vi.fn() }));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      subscribe(callback: (message: unknown) => void) {
        state.receive = callback;
      }
      unsubscribe = state.unsubscribe;
    },
  },
}));
const options: CameraCaptureOptions = {
  kind: 'service',
  name: '/camera/capture',
  messageType: 'camera/srv/Capture',
  request: '{}',
  imagePath: 'image',
  imageType: 'sensor_msgs/Image',
};
const image = (sec = 2) => ({
  header: { stamp: { sec, nanosec: 0 }, frame_id: 'optical' },
  width: 1,
  height: 1,
  encoding: 'rgb8',
  step: 3,
  data: [255, 0, 0],
});
const ros = { isConnected: true } as Ros;
afterEach(() => {
  vi.clearAllMocks();
  state.replay = false;
});
it('executes the explicit service or action and decodes its result image without a stream', async () => {
  vi.mocked(executeRosOperation).mockResolvedValue({ success: true, image: image() });
  for (const kind of ['service', 'action'] as const) {
    const result = await requestCameraCapture(ros, { ...options, kind }, new AbortController().signal);
    expect(executeRosOperation).toHaveBeenLastCalledWith(
      ros,
      expect.objectContaining({ kind, name: options.name, messageType: options.messageType }),
      expect.any(AbortSignal)
    );
    expect(result.frame.image).toMatchObject({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) });
    result.release();
  }
});
it('rejects replay, malformed requests and unsuccessful captures before exporting anything', async () => {
  state.replay = true;
  await expect(requestCameraCapture(ros, options, new AbortController().signal)).rejects.toThrow('replay');
  expect(executeRosOperation).not.toHaveBeenCalled();
  state.replay = false;
  await expect(requestCameraCapture(ros, { ...options, request: '[]' }, new AbortController().signal)).rejects.toThrow(
    'JSON object'
  );
  expect(executeRosOperation).not.toHaveBeenCalled();
  vi.mocked(executeRosOperation).mockResolvedValue({ success: false, message: 'Camera busy' });
  await expect(requestCameraCapture(ros, options, new AbortController().signal)).rejects.toThrow('Camera busy');
});
it('associates topic output with the result stamp, including images delivered before the response', async () => {
  vi.mocked(executeRosOperation).mockImplementation(async () => {
    state.receive(image(1));
    state.receive(image(2));
    return { stamp: { sec: 2, nanosec: 0 } };
  });
  const result = await requestCameraCapture(
    ros,
    { ...options, outputTopic: '/camera/captured', resultStampPath: 'stamp' },
    new AbortController().signal
  );
  expect(result.frame.header?.stamp).toEqual({ sec: 2, nanosec: 0 });
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  result.release();
});
it('requires explicit correlation and cleans up an unmatched/cancelled topic capture', async () => {
  await expect(
    requestCameraCapture(ros, { ...options, outputTopic: '/captured' }, new AbortController().signal)
  ).rejects.toThrow('timestamp field');
  vi.mocked(executeRosOperation).mockImplementation(async () => {
    state.receive(image(1));
    return { stamp: { sec: 2, nanosec: 0 } };
  });
  const abort = new AbortController();
  const result = requestCameraCapture(
    ros,
    { ...options, outputTopic: '/captured', resultStampPath: 'stamp' },
    abort.signal
  );
  const check = expect(result).rejects.toThrow('cancelled');
  await Promise.resolve();
  abort.abort();
  await check;
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
