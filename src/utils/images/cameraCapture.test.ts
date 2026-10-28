import { afterEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { requestCameraCapture } from './cameraCapture';
import { executeRosOperation } from '../rosOperations';
import type { CameraCaptureOptions } from './cameraImageOptions';
import * as decoder from './decodeImage';
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
  vi.restoreAllMocks();
  vi.useRealTimers();
  state.replay = false;
});

it('rejects disconnected sources and invalid bindings before issuing robot commands', async () => {
  await expect(
    requestCameraCapture({ isConnected: false } as Ros, options, new AbortController().signal)
  ).rejects.toThrow('disconnected');
  for (const [patch, error] of [
    [{ name: 'relative/capture' }, 'valid capture'],
    [{ messageType: 'not an interface' }, 'valid capture'],
    [{ kind: 'topic' }, 'valid capture'],
    [{ imageType: 'std_msgs/String' }, 'supported capture image'],
    [{ request: ' '.repeat(16385) }, '16 KiB'],
    [{ request: 'null' }, 'JSON object'],
    [{ request: '{' }, 'JSON'],
  ] as const) {
    await expect(
      requestCameraCapture(ros, { ...options, ...patch } as CameraCaptureOptions, new AbortController().signal)
    ).rejects.toThrow(error);
  }
  expect(executeRosOperation).not.toHaveBeenCalled();
});

it('uses only own result fields and rejects missing, dangerous or oversized field paths', async () => {
  vi.mocked(executeRosOperation).mockResolvedValue({ image: image() });
  for (const imagePath of ['missing.image', '__proto__.image', 'constructor', 'image..data']) {
    await expect(requestCameraCapture(ros, { ...options, imagePath }, new AbortController().signal)).rejects.toThrow(
      'Image message is invalid'
    );
  }
  await expect(
    requestCameraCapture(ros, { ...options, imagePath: 'x'.repeat(257) }, new AbortController().signal)
  ).rejects.toThrow('field path is too long');
  vi.mocked(executeRosOperation).mockResolvedValue(image());
  const result = await requestCameraCapture(
    ros,
    { ...options, imagePath: '', request: '' },
    new AbortController().signal
  );
  expect(result.frame.header?.stamp).toEqual({ sec: 2, nanosec: 0 });
  result.release();
});

it('rejects failed or unstamped topic responses and always removes the output subscription', async () => {
  for (const response of [{ success: false }, {}, { stamp: { sec: 0, nanosec: 0 } }]) {
    vi.mocked(executeRosOperation).mockResolvedValueOnce(response);
    await expect(
      requestCameraCapture(
        ros,
        { ...options, outputTopic: '/captured', resultStampPath: 'stamp' },
        new AbortController().signal
      )
    ).rejects.toThrow(/rejected|acquisition timestamp/);
  }
  expect(state.unsubscribe).toHaveBeenCalledTimes(3);
});

it('bounds pending topic images and times out instead of matching an evicted or unstamped image', async () => {
  vi.useFakeTimers();
  vi.mocked(executeRosOperation).mockImplementation(async () => {
    state.receive({ ...image(), header: {} });
    state.receive(image(0));
    for (let sec = 1; sec <= 5; sec++) state.receive(image(sec));
    return { stamp: { sec: 1, nanosec: 0 } };
  });
  const pending = requestCameraCapture(
    ros,
    { ...options, outputTopic: '/captured', resultStampPath: 'stamp', timeoutSec: 1 },
    new AbortController().signal
  );
  const check = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(1000);
  await check;
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('matches a later topic image exactly and forwards cancellation when the caller is already aborted', async () => {
  vi.mocked(executeRosOperation).mockResolvedValue({ stamp: { sec: 3, nanosec: 0 } });
  const pending = requestCameraCapture(
    ros,
    { ...options, outputTopic: '/captured', resultStampPath: 'stamp' },
    new AbortController().signal
  );
  await Promise.resolve();
  state.receive(image(2));
  state.receive(image(3));
  const result = await pending;
  expect(result.frame.header?.stamp).toEqual({ sec: 3, nanosec: 0 });
  result.release();
  const abort = new AbortController();
  abort.abort();
  vi.mocked(executeRosOperation).mockImplementation(async (_ros, _operation, signal) => {
    expect(signal?.aborted).toBe(true);
    return { image: image() };
  });
  await expect(requestCameraCapture(ros, options, abort.signal)).rejects.toThrow('cancelled');
});

it('closes a bitmap if cancellation arrives while decoding the capture result', async () => {
  const abort = new AbortController();
  const close = vi.fn();
  vi.mocked(executeRosOperation).mockResolvedValue({ image: image() });
  vi.spyOn(decoder, 'decodeImageFrame').mockImplementationOnce(async () => {
    abort.abort();
    return { image: { width: 1, height: 1, close } as unknown as ImageBitmap, encoding: 'jpeg' };
  });
  await expect(requestCameraCapture(ros, options, abort.signal)).rejects.toThrow('cancelled');
  expect(close).toHaveBeenCalledOnce();
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
