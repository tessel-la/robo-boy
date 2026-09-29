// Values in a result that deserve more than a line of text. Detectors look at one value of a payload and say what it
// is; the inspector shows what they find (an image preview, a binary summary) and falls back to the generic tree for
// everything else. A new kind of rich value is one more detector.

export interface RawImage {
  kind: 'raw-image';
  width: number;
  height: number;
  encoding: string;
  step?: number;
  isBigEndian: boolean;
  /** base64 (as rosbridge sends uint8[]), or the bytes themselves. */
  data: string | ArrayLike<number>;
}

export interface EncodedImage {
  kind: 'encoded-image';
  /** image/jpeg, image/png… */
  mime: string;
  /** The ROS `format` string, when the image was a CompressedImage. */
  format?: string;
  base64: string;
}

export interface BinaryValue {
  kind: 'binary';
  byteLength: number;
}

export type RichValue = RawImage | EncodedImage | BinaryValue;

export interface RichValueDetector {
  id: string;
  detect(value: unknown, fieldName?: string): RichValue | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isByteArrayLike = (value: unknown): value is ArrayLike<number> =>
  value instanceof Uint8Array
  || (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number');

/** base64 with its padding; long enough to be data rather than a word. */
const BASE64 = /^[A-Za-z0-9+/\r\n]+={0,2}$/;
const looksLikeBase64 = (value: string, minLength = 64) => value.length >= minLength && BASE64.test(value.slice(0, 4096));

export const base64ByteLength = (value: string): number => {
  const clean = value.replace(/[\r\n]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
};

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/[\r\n]/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const bytesOf = (data: string | ArrayLike<number>): Uint8Array =>
  typeof data === 'string' ? decodeBase64(data) : data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);

/** The image type of a base64 payload, from its first bytes. */
export function sniffImageMime(base64: string): string | undefined {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('Qk')) return 'image/bmp';
  return undefined;
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,/i;

/** sensor_msgs/Image, however it arrived: base64 data from rosbridge, or a plain number array. */
export const rawImageDetector: RichValueDetector = {
  id: 'raw-image',
  detect(value) {
    if (!isRecord(value)) return null;
    const { width, height, encoding, data } = value;
    if (typeof width !== 'number' || typeof height !== 'number' || typeof encoding !== 'string') return null;
    if (!(typeof data === 'string' || isByteArrayLike(data))) return null;
    return {
      kind: 'raw-image',
      width,
      height,
      encoding,
      step: typeof value.step === 'number' ? value.step : undefined,
      isBigEndian: Boolean(value.is_bigendian),
      data,
    };
  },
};

/** sensor_msgs/CompressedImage: `format` and compressed `data`. */
export const compressedImageDetector: RichValueDetector = {
  id: 'compressed-image',
  detect(value) {
    if (!isRecord(value) || typeof value.format !== 'string' || !('data' in value)) return null;
    const format = value.format.toLowerCase();
    const base64 = typeof value.data === 'string'
      ? value.data
      : isByteArrayLike(value.data)
        ? bytesToBase64(bytesOf(value.data))
        : undefined;
    if (!base64) return null;
    // compressedDepth images carry a header before the PNG; the rest of the formats name their codec.
    if (format.includes('compresseddepth')) return null;
    const mime = sniffImageMime(base64)
      ?? (format.includes('png') ? 'image/png' : format.includes('jpeg') || format.includes('jpg') ? 'image/jpeg' : undefined);
    return mime ? { kind: 'encoded-image', mime, format: value.format, base64 } : null;
  },
};

/** An image as a string: a data URL, or base64 whose first bytes are an image file's. */
export const encodedImageStringDetector: RichValueDetector = {
  id: 'encoded-image-string',
  detect(value) {
    if (typeof value !== 'string') return null;
    const dataUrl = DATA_URL.exec(value);
    if (dataUrl) return { kind: 'encoded-image', mime: dataUrl[1].toLowerCase(), base64: value.slice(dataUrl[0].length) };
    if (!looksLikeBase64(value, 96)) return null;
    const mime = sniffImageMime(value);
    return mime ? { kind: 'encoded-image', mime, base64: value } : null;
  },
};

/** Encoded bytes mix upper and lower case with digits or symbols; a long word or hash of one kind does not. */
const looksEncoded = (sample: string) => /[A-Z]/.test(sample) && /[a-z]/.test(sample) && /[0-9+/]/.test(sample);

/** Long byte arrays and base64 blobs: summarised rather than printed. */
export const binaryDetector: RichValueDetector = {
  id: 'binary',
  detect(value, fieldName) {
    if (value instanceof Uint8Array) return { kind: 'binary', byteLength: value.length };
    if (typeof value === 'string' && looksLikeBase64(value, 512) && looksEncoded(value.slice(0, 512))) {
      return { kind: 'binary', byteLength: base64ByteLength(value) };
    }
    // uint8[] fields rosbridge did not encode, e.g. `data` of a message it passed through as numbers.
    if (Array.isArray(value) && value.length > 256 && (fieldName === 'data' || /bytes|blob|payload|buffer/i.test(fieldName ?? ''))
      && value.every((item, index) => index > 64 || (Number.isInteger(item) && item >= 0 && item <= 255))) {
      return { kind: 'binary', byteLength: value.length };
    }
    return null;
  },
};

/** In the order they are tried: the most specific first. */
export const RICH_VALUE_DETECTORS: RichValueDetector[] = [
  rawImageDetector,
  compressedImageDetector,
  encodedImageStringDetector,
  binaryDetector,
];

export function detectRichValue(value: unknown, fieldName?: string, detectors = RICH_VALUE_DETECTORS): RichValue | null {
  for (const detector of detectors) {
    const found = detector.detect(value, fieldName);
    if (found) return found;
  }
  return null;
}

export const isImage = (value: RichValue | null): value is RawImage | EncodedImage =>
  value?.kind === 'raw-image' || value?.kind === 'encoded-image';

/** Whether a payload holds an image anywhere, looking a few levels down (images inside results, arrays of images). */
export function containsImage(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (depth > 6 || value === null || value === undefined) return false;
  if (isImage(detectRichValue(value))) return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const children = Array.isArray(value) ? value.slice(0, 50) : Object.values(value as Record<string, unknown>);
  return children.some(child => containsImage(child, depth + 1, seen));
}

// ---------------------------------------------------------------------------------------------------------------
// Decoding sensor_msgs/Image into pixels.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface DecodedPixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Channels per pixel and bytes per channel of the encodings Robo-Boy can draw. */
const ENCODINGS: Record<string, { channels: number; bytes: number; order: 'rgb' | 'bgr' | 'gray'; float?: boolean; alpha?: boolean }> = {
  rgb8: { channels: 3, bytes: 1, order: 'rgb' },
  bgr8: { channels: 3, bytes: 1, order: 'bgr' },
  rgba8: { channels: 4, bytes: 1, order: 'rgb', alpha: true },
  bgra8: { channels: 4, bytes: 1, order: 'bgr', alpha: true },
  '8uc3': { channels: 3, bytes: 1, order: 'bgr' },
  '8uc4': { channels: 4, bytes: 1, order: 'bgr', alpha: true },
  mono8: { channels: 1, bytes: 1, order: 'gray' },
  '8uc1': { channels: 1, bytes: 1, order: 'gray' },
  mono16: { channels: 1, bytes: 2, order: 'gray' },
  '16uc1': { channels: 1, bytes: 2, order: 'gray' },
  '32fc1': { channels: 1, bytes: 4, order: 'gray', float: true },
};

/** The most pixels an image preview decodes (about a 16 MP frame). */
const MAX_PIXELS = 16_000_000;

/**
 * Pixels of a sensor_msgs/Image, ready for a canvas. Depth images (16-bit and float) are stretched between their
 * nearest and farthest valid values. Throws with a readable reason when the image cannot be drawn.
 */
export function decodeRawImage(image: RawImage): DecodedPixels {
  const encoding = image.encoding.toLowerCase();
  const layout = ENCODINGS[encoding];
  if (!layout) throw new Error(`The “${image.encoding}” encoding cannot be previewed.`);
  const { width, height } = image;
  if (!(width > 0 && height > 0) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`The image says it is ${width}×${height}.`);
  }
  if (width * height > MAX_PIXELS) throw new Error(`The image is too large to preview (${width}×${height}).`);

  const bytes = bytesOf(image.data);
  const pixelBytes = layout.channels * layout.bytes;
  const step = image.step && image.step >= width * pixelBytes ? image.step : width * pixelBytes;
  if (bytes.length < step * (height - 1) + width * pixelBytes) {
    throw new Error(`The image data is shorter than ${width}×${height} ${image.encoding} needs.`);
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = !image.isBigEndian;

  if (layout.bytes === 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = y * step + x * pixelBytes;
        const target = (y * width + x) * 4;
        if (layout.order === 'gray') {
          rgba[target] = rgba[target + 1] = rgba[target + 2] = bytes[source];
        } else {
          const first = bytes[source];
          const third = bytes[source + 2];
          rgba[target] = layout.order === 'rgb' ? first : third;
          rgba[target + 1] = bytes[source + 1];
          rgba[target + 2] = layout.order === 'rgb' ? third : first;
        }
        rgba[target + 3] = layout.alpha ? bytes[source + 3] : 255;
      }
    }
    return { width, height, rgba };
  }

  // Depth: find the range of valid values, then stretch it to grey.
  const read = (offset: number) => (layout.float ? view.getFloat32(offset, littleEndian) : view.getUint16(offset, littleEndian));
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = read(y * step + x * pixelBytes);
      if (Number.isFinite(value) && value > 0) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  const span = max > min ? max - min : 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = read(y * step + x * pixelBytes);
      const target = (y * width + x) * 4;
      const grey = Number.isFinite(value) && value > 0 ? 255 - Math.round(((value - min) / span) * 255) : 0;
      rgba[target] = rgba[target + 1] = rgba[target + 2] = grey;
      rgba[target + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** A URL an <img> can show for an image value; raw images are drawn onto a canvas first. */
export function imageSource(image: RawImage | EncodedImage): string {
  if (image.kind === 'encoded-image') return `data:${image.mime};base64,${image.base64}`;
  const pixels = decodeRawImage(image);
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the image.');
  context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export const describeImage = (image: RawImage | EncodedImage): string =>
  image.kind === 'raw-image'
    ? `${image.width}×${image.height} · ${image.encoding}`
    : `${image.format ?? image.mime.replace('image/', '').toUpperCase()} · ${formatBytes(base64ByteLength(image.base64))}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
