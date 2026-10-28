import { afterEach, expect, it, vi } from 'vitest';
import { shareImageFrame } from './sharedImageFrame';
import { cameraFramePng } from './cameraSnapshot';
afterEach(() => vi.restoreAllMocks());
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
