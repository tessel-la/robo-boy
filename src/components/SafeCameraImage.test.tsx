import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SafeCameraImage, { isSafeCameraImageSrc } from './SafeCameraImage';

describe('SafeCameraImage', () => {
  it('releases the image source when the camera is unmounted', () => {
    const { unmount } = render(
      <SafeCameraImage src="/video_stream/stream?topic=/camera/image_raw&type=mjpeg" alt="Camera" />
    );
    const image = screen.getByAltText('Camera');
    expect(image).toHaveAttribute('src');
    unmount();
    expect(image).not.toHaveAttribute('src');
  });

  it('releases a stream when the allowed camera server changes', () => {
    const src = 'http://localhost:8080/stream?topic=/camera/image_raw&type=mjpeg';
    const { rerender } = render(
      <SafeCameraImage src={src} allowedStreamBaseUrl="http://localhost:8080" alt="Camera" />
    );
    const image = screen.getByAltText('Camera');
    expect(image).toHaveAttribute('src', src);

    rerender(<SafeCameraImage src={src} allowedStreamBaseUrl="http://localhost:8081" alt="Camera" />);
    expect(image).not.toHaveAttribute('src');

    const replacement = src.replace(':8080/', ':8081/');
    rerender(<SafeCameraImage src={replacement} allowedStreamBaseUrl="http://localhost:8081" alt="Camera" />);
    expect(image).toHaveAttribute('src', replacement);
  });

  it('allows relative proxied camera streams', () => {
    expect(isSafeCameraImageSrc('/video_stream/stream?topic=/camera/image_raw&type=mjpeg')).toBe(true);
    expect(isSafeCameraImageSrc('/video_stream/stream?topic=%2Fcamera%2Fimage_raw&type=mjpeg')).toBe(true);
  });

  it('preserves validated refresh tokens and rejects injected refresh values', () => {
    const src = '/video_stream/stream?topic=/camera/image_raw&type=mjpeg&_refresh=123abc-456def';
    render(<SafeCameraImage src={src} alt="Refreshed camera" />);
    expect(screen.getByAltText('Refreshed camera')).toHaveAttribute('src', src);
    expect(isSafeCameraImageSrc(src.replace('123abc-456def', ''))).toBe(false);
    expect(isSafeCameraImageSrc(src.replace('123abc-456def', '%2F%2Fevil.example'))).toBe(false);
  });

  it('allows absolute camera stream URLs only for the configured base', () => {
    expect(
      isSafeCameraImageSrc('http://localhost:8080/stream?topic=/camera/image_raw&type=mjpeg', 'http://localhost:8080')
    ).toBe(true);
    expect(
      isSafeCameraImageSrc('http://example.com/stream?topic=/camera/image_raw&type=mjpeg', 'http://localhost:8080')
    ).toBe(false);
  });

  it('allows image data URLs and rejects non-image sources', () => {
    expect(isSafeCameraImageSrc('data:image/jpeg;base64,abc123==')).toBe(true);
    expect(isSafeCameraImageSrc('javascript:alert(1)')).toBe(false);
  });

  it('rejects streams with invalid topics or unexpected parameters', () => {
    expect(isSafeCameraImageSrc('/video_stream/stream?topic=/camera/image_raw%26x%3D1&type=mjpeg')).toBe(false);
    expect(isSafeCameraImageSrc('/video_stream/stream?topic=/camera/image_raw&type=mjpeg&next=1')).toBe(false);
  });
});
