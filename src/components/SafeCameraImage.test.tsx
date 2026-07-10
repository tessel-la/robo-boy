import { describe, expect, it } from 'vitest';
import { isSafeCameraImageSrc } from './SafeCameraImage';

describe('SafeCameraImage', () => {
  it('allows relative proxied camera streams', () => {
    expect(isSafeCameraImageSrc('/video_stream/stream?topic=%2Fcamera%2Fimage_raw&type=mjpeg')).toBe(true);
  });

  it('allows absolute camera stream URLs', () => {
    expect(isSafeCameraImageSrc('http://localhost:8080/stream?topic=%2Fcamera%2Fimage_raw&type=mjpeg')).toBe(true);
  });

  it('allows image data URLs and rejects non-image sources', () => {
    expect(isSafeCameraImageSrc('data:image/jpeg;base64,abc123==')).toBe(true);
    expect(isSafeCameraImageSrc('javascript:alert(1)')).toBe(false);
  });
});
