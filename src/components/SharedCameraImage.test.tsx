import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { Ros } from 'roslib';
import SharedCameraImage from './SharedCameraImage';
import type { ImageEvent } from '../utils/images/sharedImageFrame';
const source = vi.hoisted(() => ({ listener: (_event: ImageEvent) => {}, stop: vi.fn() }));
vi.mock('../utils/images/mjpegStreams', () => ({
  subscribeToMjpeg: vi.fn((_ros, _url, _base, listener) => {
    source.listener = listener;
    return source.stop;
  }),
}));
const draw = vi.fn();
const props = {
  ros: {} as Ros,
  src: '/video_stream/stream?topic=/camera/image_raw&type=mjpeg',
  baseUrl: '/video_stream',
  alt: 'Camera stream',
  onError: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('createImageBitmap', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('draws full-rate shared frames without depending on TF and detaches on unmount', () => {
  const { unmount } = render(<SharedCameraImage {...props} />);
  const image = { width: 64, height: 48, close() {} } as ImageBitmap;
  act(() => {
    for (let i = 0; i < 20; i++)
      source.listener({ frame: { image, encoding: 'jpeg', retain: () => () => {} }, error: null });
  });
  expect(draw).toHaveBeenCalledTimes(20);
  expect(screen.getByRole('img')).toHaveAttribute('width', '64');
  expect(screen.getByRole('img')).toBeVisible();
  unmount();
  expect(source.stop).toHaveBeenCalledOnce();
});
it('keeps native playback available when the streamed reader or canvas is unsupported', () => {
  render(<SharedCameraImage {...props} />);
  act(() => source.listener({ frame: null, error: 'CORS or streaming is unsupported' }));
  expect(source.stop).toHaveBeenCalledOnce();
  const native = screen.getByRole('img');
  expect(native.tagName).toBe('IMG');
  expect(native).toHaveAttribute('src', props.src);
  fireEvent.error(native);
  expect(props.onError).toHaveBeenCalledOnce();
});
