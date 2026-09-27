import { describe, expect, it } from 'vitest';
import { compressedImageBlob, isImageType, rawImageToRgba } from './imageFrames';

const pixels = (frame: { data: Uint8ClampedArray }) => Array.from(frame.data);

describe('rawImageToRgba', () => {
  it('reorders colour channels and skips row padding', () => {
    // 2×2, three bytes per pixel, rows padded to 8 bytes.
    const data = Uint8Array.from([10, 20, 30, 40, 50, 60, 0, 0, 70, 80, 90, 100, 110, 120, 0, 0]);
    expect(pixels(rawImageToRgba({ width: 2, height: 2, encoding: 'rgb8', step: 8, data }))).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    ]);
    expect(pixels(rawImageToRgba({ width: 2, height: 2, encoding: 'bgr8', step: 8, data })).slice(0, 4)).toEqual([30, 20, 10, 255]);
    expect(pixels(rawImageToRgba({ width: 1, height: 1, encoding: 'bgra8', step: 4, data: Uint8Array.from([1, 2, 3, 4]) }))).toEqual([3, 2, 1, 4]);
    expect(pixels(rawImageToRgba({ width: 2, height: 1, encoding: 'mono8', step: 2, data: Uint8Array.from([0, 200]) }))).toEqual([0, 0, 0, 255, 200, 200, 200, 255]);
  });

  it('stretches 16-bit and float depth to grey, leaving missing depth black', () => {
    const big = Uint8Array.from([0x01, 0x00, 0x02, 0x00, 0x00, 0x00]); // 256, 512, 0 big-endian
    expect(pixels(rawImageToRgba({ width: 3, height: 1, encoding: '16UC1', step: 6, is_bigendian: 1, data: big }))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const floats = new Uint8Array(new Float32Array([1, 3, Number.NaN]).buffer);
    expect(pixels(rawImageToRgba({ width: 3, height: 1, encoding: '32FC1', step: 12, data: floats }))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });

  it('converts packed YUV 4:2:2', () => {
    // Mid-grey luma with neutral chroma is grey in both byte orders.
    expect(pixels(rawImageToRgba({ width: 2, height: 1, encoding: 'uyvy', step: 4, data: Uint8Array.from([128, 100, 128, 200]) }))).toEqual([
      100, 100, 100, 255, 200, 200, 200, 255,
    ]);
    expect(pixels(rawImageToRgba({ width: 2, height: 1, encoding: 'yuyv', step: 4, data: Uint8Array.from([100, 128, 200, 128]) }))).toEqual([
      100, 100, 100, 255, 200, 200, 200, 255,
    ]);
  });

  it('says which images it cannot show', () => {
    expect(() => rawImageToRgba({ width: 1, height: 1, encoding: 'bayer_rggb8', step: 1, data: new Uint8Array(1) })).toThrow('Replay cannot show bayer_rggb8 images yet.');
    expect(() => rawImageToRgba({ width: 4, height: 4, encoding: 'rgb8', step: 12, data: new Uint8Array(20) })).toThrow('empty or truncated');
    expect(() => rawImageToRgba({ width: 0, height: 0, encoding: 'rgb8', step: 0, data: new Uint8Array() })).toThrow('empty or truncated');
  });
});

describe('compressed images', () => {
  it('hands the encoded bytes to the browser decoder, without the compressed depth header', async () => {
    const jpeg = compressedImageBlob({ format: 'rgb8; jpeg compressed bgr8', data: Uint8Array.from([0xff, 0xd8, 0xff]) });
    expect(jpeg.type).toBe('image/jpeg');
    expect(jpeg.size).toBe(3);
    const depth = compressedImageBlob({ format: '16UC1; compressedDepth png', data: new Uint8Array(20) });
    expect(depth.type).toBe('image/png');
    expect(depth.size).toBe(8);
  });

  it('recognises camera message types from either ROS generation', () => {
    expect(['sensor_msgs/msg/Image', 'sensor_msgs/CompressedImage'].every(isImageType)).toBe(true);
    expect(isImageType('nav_msgs/msg/Odometry')).toBe(false);
  });
});
