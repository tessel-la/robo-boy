import { afterEach, expect, it, vi } from 'vitest';
import { shareImageFrame } from './sharedImageFrame';
import { cameraFramePng, downloadCameraBlob } from './cameraSnapshot';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('keeps exactly the selected bitmap alive across asynchronous PNG encoding and stream replacement', async () => {
  const image = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
  const owned = shareImageFrame({ image, encoding: 'webrtc' });
  let finish: BlobCallback = () => {};
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
    finish = callback;
  });
  const result = cameraFramePng(owned.frame);
  owned.release();
  expect(image.close).not.toHaveBeenCalled();
  expect(draw).toHaveBeenCalledWith(image, 0, 0);
  const blob = new Blob(['png']);
  finish(blob);
  await expect(result).resolves.toBe(blob);
  expect(image.close).toHaveBeenCalledOnce();
});

it('exports raw RGBA pixels at their displayed resolution and releases its frame after encoding failure', async () => {
  const data = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  const release = vi.fn();
  const frame = { image: { width: 2, height: 1, data }, encoding: 'rgb8', retain: () => release };
  const put = vi.fn();
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: put } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type
  ) {
    expect(this.width).toBe(2);
    expect(this.height).toBe(1);
    expect(type).toBe('image/png');
    callback(null);
  });
  await expect(cameraFramePng(frame)).rejects.toThrow('could not be encoded');
  expect(put).toHaveBeenCalledWith(expect.objectContaining({ data, width: 2, height: 1 }), 0, 0);
  expect(put.mock.calls[0][0].data).not.toBe(data);
  expect(release).toHaveBeenCalledOnce();
});

it('releases the retained frame when canvas export is unavailable or drawing fails', async () => {
  const release = vi.fn();
  const frame = {
    image: { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap,
    encoding: 'webrtc',
    retain: () => release,
  };
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  await expect(cameraFramePng(frame)).rejects.toThrow('cannot export');
  expect(release).toHaveBeenCalledOnce();
  context.mockReturnValue({
    drawImage: () => {
      throw new Error('Bitmap is unreadable');
    },
  } as any);
  await expect(cameraFramePng(frame)).rejects.toThrow('Bitmap is unreadable');
  expect(release).toHaveBeenCalledTimes(2);
});

it('downloads a named blob and revokes its temporary URL after the browser has consumed it', () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => 'blob:camera-image'),
    revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('front.png');
    expect(this.href).toBe('blob:camera-image');
  });
  const blob = new Blob(['png']);
  downloadCameraBlob(blob, 'front.png');
  expect(createObjectURL).toHaveBeenCalledWith(blob);
  expect(click).toHaveBeenCalledOnce();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:camera-image');
});
