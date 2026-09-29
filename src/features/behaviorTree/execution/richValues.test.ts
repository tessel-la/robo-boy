import { describe, expect, it } from 'vitest';
import {
  bytesToBase64,
  containsImage,
  decodeRawImage,
  describeImage,
  detectRichValue,
  type RawImage,
} from './richValues';
import { extractDiagnostics, isEmptyPayload } from './executionModel';

const JPEG = `/9j/4AAQSkZJRgABAQAAAQABAAD${'A'.repeat(200)}`;
const PNG = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB${'A'.repeat(200)}`;

const raw = (encoding: string, width: number, height: number, bytes: number[], extra: Partial<RawImage> = {}) =>
  detectRichValue({ header: {}, height, width, encoding, is_bigendian: 0, step: extra.step ?? 0, data: bytesToBase64(Uint8Array.from(bytes)) }) as RawImage;

const pixel = (image: ReturnType<typeof decodeRawImage>, x: number, y: number) =>
  Array.from(image.rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe('rich values', () => {
  it('recognises sensor_msgs/Image, with base64 or number data', () => {
    const image = detectRichValue({ height: 1, width: 2, encoding: 'rgb8', step: 6, is_bigendian: 0, data: 'AAECAwQF' });
    expect(image).toMatchObject({ kind: 'raw-image', width: 2, height: 1, encoding: 'rgb8', step: 6 });
    expect(detectRichValue({ height: 1, width: 1, encoding: 'mono8', data: [128] })).toMatchObject({ kind: 'raw-image' });
    expect(describeImage(image as RawImage)).toBe('2×1 · rgb8');
  });

  it('decodes the common encodings into pixels', () => {
    expect(pixel(decodeRawImage(raw('rgb8', 1, 1, [10, 20, 30])), 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(decodeRawImage(raw('bgr8', 1, 1, [10, 20, 30])), 0, 0)).toEqual([30, 20, 10, 255]);
    expect(pixel(decodeRawImage(raw('bgra8', 1, 1, [10, 20, 30, 40])), 0, 0)).toEqual([30, 20, 10, 40]);
    expect(pixel(decodeRawImage(raw('mono8', 1, 1, [77])), 0, 0)).toEqual([77, 77, 77, 255]);
  });

  it('skips row padding', () => {
    // Two 1-pixel rows of rgb8, each padded to 4 bytes.
    const image = decodeRawImage(raw('rgb8', 1, 2, [1, 2, 3, 0, 4, 5, 6, 0], { step: 4 }));
    expect(pixel(image, 0, 1)).toEqual([4, 5, 6, 255]);
  });

  it('stretches depth between its nearest and farthest readings', () => {
    // 16UC1, little endian: 1000 mm, 2000 mm, and 0 (no reading).
    const depth = decodeRawImage(raw('16UC1', 3, 1, [0xe8, 0x03, 0xd0, 0x07, 0x00, 0x00]));
    expect(pixel(depth, 0, 0)[0]).toBe(255);
    expect(pixel(depth, 1, 0)[0]).toBe(0);
    expect(pixel(depth, 2, 0)).toEqual([0, 0, 0, 255]);

    const floats = new Float32Array([0.5, 1.5, Number.NaN]);
    const metres = decodeRawImage(raw('32FC1', 3, 1, Array.from(new Uint8Array(floats.buffer))));
    expect(pixel(metres, 0, 0)[0]).toBe(255);
    expect(pixel(metres, 2, 0)[0]).toBe(0);
  });

  it('refuses what it cannot draw, with a reason', () => {
    expect(() => decodeRawImage(raw('bayer_rggb8', 1, 1, [1]))).toThrow('The “bayer_rggb8” encoding cannot be previewed.');
    expect(() => decodeRawImage(raw('rgb8', 2, 2, [1, 2, 3]))).toThrow(/shorter than 2×2 rgb8/);
    expect(() => decodeRawImage(raw('rgb8', 0, 2, []))).toThrow(/says it is 0×2/);
  });

  it('recognises compressed images by their bytes or their format', () => {
    expect(detectRichValue({ header: {}, format: 'jpeg', data: JPEG })).toMatchObject({ kind: 'encoded-image', mime: 'image/jpeg', format: 'jpeg' });
    expect(detectRichValue({ format: 'rgb8; png compressed bgr8', data: PNG })).toMatchObject({ mime: 'image/png' });
    // Number data (not base64-encoded by the bridge) works too.
    expect(detectRichValue({ format: 'png', data: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] })).toMatchObject({ kind: 'encoded-image', mime: 'image/png' });
    // A message that only happens to have `format` and `data` is not an image.
    expect(detectRichValue({ format: 'json', data: '{"a":1}' })).toBeNull();
  });

  it('recognises images sent as text: data URLs and bare base64', () => {
    expect(detectRichValue(`data:image/png;base64,${PNG}`)).toMatchObject({ kind: 'encoded-image', mime: 'image/png', base64: PNG });
    expect(detectRichValue(JPEG)).toMatchObject({ kind: 'encoded-image', mime: 'image/jpeg' });
    expect(detectRichValue('Captured frame 12')).toBeNull();
  });

  it('summarises binary data instead of printing it', () => {
    expect(detectRichValue(bytesToBase64(Uint8Array.from({ length: 600 }, (_, i) => (i * 97 + 13) % 256)))).toEqual({ kind: 'binary', byteLength: 600 });
    // Long text of one kind (a word repeated, a hex hash) stays text.
    expect(detectRichValue('x'.repeat(1000))).toBeNull();
    expect(detectRichValue('a3f9'.repeat(200))).toBeNull();
    expect(detectRichValue(Array.from({ length: 300 }, (_, i) => i % 256), 'data')).toEqual({ kind: 'binary', byteLength: 300 });
    expect(detectRichValue(Array.from({ length: 300 }, (_, i) => i), 'ranges')).toBeNull();
  });

  it('finds images anywhere in a result', () => {
    expect(containsImage({ status: 'ok', frames: [{ image: { format: 'jpeg', data: JPEG } }] })).toBe(true);
    expect(containsImage({ status: 'ok', values: [1, 2, 3] })).toBe(false);
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(containsImage(cyclic)).toBe(false);
  });

  it('reads the conventional status fields of any result or response', () => {
    expect(extractDiagnostics({ success: false, message: ' Camera busy ' })).toEqual({ reportsFailure: true, message: 'Camera busy', code: undefined });
    expect(extractDiagnostics({ error_code: 3, error_string: 'Timeout' })).toEqual({ reportsFailure: true, message: 'Timeout', code: 3 });
    expect(extractDiagnostics({ error_code: { value: 0 } })).toEqual({ reportsFailure: false, message: undefined, code: 0 });
    expect(extractDiagnostics({ success: true, message: 'Done', error_code: 7 })).toMatchObject({ reportsFailure: false });
    expect(extractDiagnostics('text')).toEqual({ reportsFailure: false });
    expect(isEmptyPayload({ structure_needs_at_least_one_member: 0 })).toBe(true);
    expect(isEmptyPayload({ ok: true })).toBe(false);
    expect(isEmptyPayload(0)).toBe(false);
  });
});
