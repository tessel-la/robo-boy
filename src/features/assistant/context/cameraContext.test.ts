import ROSLIB, { type Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraFrameTopics, captureCameraFrame, imageMessageToJpeg, messageBytes, wantsCameraFrame } from './cameraContext';

describe('camera frames for the assistant', () => {
  it('captures only for questions about what a camera shows', () => {
    for (const phrase of ['what does the camera see', 'describe the image', 'is there anyone in front of the camera', 'what is visible in the frame'])
      expect(wantsCameraFrame(phrase), phrase).toBe(true);
    for (const phrase of ['remove the camera panel', 'lower the camera quality', 'switch the camera topic to /x', 'add a 3D view'])
      expect(wantsCameraFrame(phrase), phrase).toBe(false);
  });

  it('looks at named image topics first, then the open camera panels, preferring compressed versions', () => {
    const topics = [
      { name: '/front/image_raw', type: 'sensor_msgs/msg/Image' },
      { name: '/front/image_raw/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/rear/image', type: 'sensor_msgs/msg/Image' },
      { name: '/odom', type: 'nav_msgs/msg/Odometry' },
    ];
    expect(cameraFrameTopics('what does /rear/image show', ['/front/image_raw'], topics)).toEqual([
      { name: '/rear/image', type: 'sensor_msgs/msg/Image' },
      { name: '/front/image_raw/compressed', type: 'sensor_msgs/msg/CompressedImage' },
    ]);
    // A panel topic the graph does not list (yet) is still tried as a raw image.
    expect(cameraFrameTopics('what do you see', ['/unknown'], topics)).toEqual([{ name: '/unknown', type: 'sensor_msgs/msg/Image' }]);
    expect(cameraFrameTopics('what do you see /odom', [], topics)).toEqual([]);
  });

  it('reads image bytes as rosbridge and recordings deliver them', () => {
    expect(messageBytes(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]));
    expect(messageBytes([3, 4])).toEqual(new Uint8Array([3, 4]));
    expect(messageBytes(btoa(String.fromCharCode(5, 6)))).toEqual(new Uint8Array([5, 6]));
    expect(() => messageBytes(undefined)).toThrow('no pixel data');
  });
});

describe('encoding a frame', () => {
  const drawn: Array<{ width: number; height: number }> = [];
  beforeEach(() => {
    drawn.length = 0;
    const context = {
      drawImage: vi.fn((_source: unknown, _x: number, _y: number, width?: number, height?: number) => {
        if (width) drawn.push({ width, height: height! });
      }),
      putImageData: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,SlBFRw==');
    vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2048, height: 1024, close: vi.fn() })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shrinks large frames to 1024 px on the longest side and keeps small ones as they are', async () => {
    const compressed = await imageMessageToJpeg({ format: 'jpeg', data: btoa('jpeg') }, 'sensor_msgs/msg/CompressedImage');
    expect(compressed).toEqual({ data: 'SlBFRw==', width: 1024, height: 512 });
    const raw = await imageMessageToJpeg(
      { width: 2, height: 1, encoding: 'rgb8', step: 6, data: btoa(String.fromCharCode(1, 2, 3, 4, 5, 6)) },
      'sensor_msgs/msg/Image'
    );
    expect(raw).toEqual({ data: 'SlBFRw==', width: 2, height: 1 });
    expect(drawn).toEqual([{ width: 1024, height: 512 }, { width: 2, height: 1 }]);
  });

  it('waits for one message, and reports a camera that sends nothing', async () => {
    let deliver: (message: unknown) => void = () => undefined;
    const unsubscribe = vi.fn();
    vi.spyOn(ROSLIB, 'Topic').mockImplementation(function () {
      return { subscribe: (callback: (message: unknown) => void) => { deliver = callback; }, unsubscribe } as never;
    } as never);
    const ros = {} as Ros;
    const capture = captureCameraFrame(ros, { name: '/cam', type: 'sensor_msgs/msg/CompressedImage' });
    deliver({ format: 'jpeg', data: btoa('a') });
    deliver({ format: 'jpeg', data: btoa('b') });
    await expect(capture).resolves.toEqual({ topic: '/cam', mimeType: 'image/jpeg', data: 'SlBFRw==', width: 1024, height: 512 });
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const silent = captureCameraFrame(ros, { name: '/dark', type: 'sensor_msgs/msg/Image' }, { timeoutMs: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(silent).rejects.toThrow('No image arrived on /dark within 1 s.');
    const controller = new AbortController();
    const cancelled = captureCameraFrame(ros, { name: '/cam', type: 'sensor_msgs/msg/Image' }, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    vi.useRealTimers();
  });
});
