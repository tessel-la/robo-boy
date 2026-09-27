/**
 * Camera frames from a recording. Live, web_video_server encodes a camera topic into MJPEG on the
 * robot; a recording holds the messages themselves, so replay draws them in the browser.
 */
export const RAW_IMAGE_TYPES = ['sensor_msgs/msg/Image', 'sensor_msgs/Image'];
export const COMPRESSED_IMAGE_TYPES = ['sensor_msgs/msg/CompressedImage', 'sensor_msgs/CompressedImage'];
export const isImageType = (type: string) => RAW_IMAGE_TYPES.includes(type) || COMPRESSED_IMAGE_TYPES.includes(type);

export interface RawImage {
  width: number;
  height: number;
  encoding: string;
  step: number;
  is_bigendian?: number | boolean;
  data: Uint8Array;
}
export interface CompressedImage {
  format: string;
  data: Uint8Array;
}
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);

/** Depth and 16-bit images have no display range of their own: stretch each frame's finite values to grey. */
function stretch(width: number, height: number, read: (x: number, y: number) => number): RgbaFrame {
  const values = new Float64Array(width * height);
  let min = Infinity, max = -Infinity;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const value = read(x, y);
      values[i] = value;
      if (Number.isFinite(value) && value !== 0) { if (value < min) min = value; if (value > max) max = value; }
    }
  }
  const scale = max > min ? 255 / (max - min) : 0;
  const data = new Uint8ClampedArray(width * height * 4);
  values.forEach((value, i) => {
    const grey = Number.isFinite(value) && value !== 0 ? (scale ? (value - min) * scale : 255) : 0;
    data.set([grey, grey, grey, 255], i * 4);
  });
  return { width, height, data };
}

/** sensor_msgs/Image to RGBA, honouring the row stride; throws for encodings it cannot show. */
export function rawImageToRgba(image: RawImage): RgbaFrame {
  const { width, height, step, data } = image;
  const encoding = image.encoding.toLowerCase();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const little = !image.is_bigendian;
  const channels: Record<string, [number, number, number, number, number]> = {
    // bytes per pixel, then the offsets of R, G, B and A (-1 for opaque)
    rgb8: [3, 0, 1, 2, -1], bgr8: [3, 2, 1, 0, -1], '8uc3': [3, 2, 1, 0, -1],
    rgba8: [4, 0, 1, 2, 3], bgra8: [4, 2, 1, 0, 3], '8uc4': [4, 2, 1, 0, 3],
    mono8: [1, 0, 0, 0, -1], '8uc1': [1, 0, 0, 0, -1],
  };
  const layout = channels[encoding];
  const bytesPerPixel = layout?.[0] ?? { mono16: 2, '16uc1': 2, '32fc1': 4, uyvy: 2, yuv422: 2, yuyv: 2, yuv422_yuy2: 2 }[encoding];
  if (!bytesPerPixel) throw new Error(`Replay cannot show ${image.encoding} images yet.`);
  if (!width || !height || step < width * bytesPerPixel || step * (height - 1) + width * bytesPerPixel > data.length) {
    throw new Error('The recorded image is empty or truncated.');
  }
  if (layout) {
    const [bytes, r, g, b, a] = layout;
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0, o = 0; y < height; y++) {
      for (let x = 0, p = y * step; x < width; x++, p += bytes, o += 4) {
        out[o] = data[p + r]; out[o + 1] = data[p + g]; out[o + 2] = data[p + b]; out[o + 3] = a < 0 ? 255 : data[p + a];
      }
    }
    return { width, height, data: out };
  }
  if (encoding === 'mono16' || encoding === '16uc1') return stretch(width, height, (x, y) => view.getUint16(y * step + x * 2, little));
  if (encoding === '32fc1') return stretch(width, height, (x, y) => view.getFloat32(y * step + x * 4, little));
  const yuv = { uyvy: [1, 0, 3, 2], yuv422: [1, 0, 3, 2], yuyv: [0, 1, 2, 3], yuv422_yuy2: [0, 1, 2, 3] }[encoding];
  if (yuv) {
    // Two pixels share one U and one V sample; offsets are Y0, U, Y1, V within each 4-byte group.
    const [y0, u, y1, v] = yuv;
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += 2) {
        const p = y * step + x * 2;
        const cb = data[p + u] - 128, cr = data[p + v] - 128;
        const put = (o: number, luma: number) => {
          out[o] = clamp(luma + 1.402 * cr); out[o + 1] = clamp(luma - 0.344136 * cb - 0.714136 * cr); out[o + 2] = clamp(luma + 1.772 * cb); out[o + 3] = 255;
        };
        put((y * width + x) * 4, data[p + y0]);
        if (x + 1 < width) put((y * width + x + 1) * 4, data[p + y1]);
      }
    }
    return { width, height, data: out };
  }
  throw new Error(`Replay cannot show ${image.encoding} images yet.`);
}

/** The encoded image inside a sensor_msgs/CompressedImage, ready for the browser's decoder. */
export function compressedImageBlob(image: CompressedImage): Blob {
  const format = image.format.toLowerCase();
  // compressed_depth_image_transport prefixes the PNG with a 12-byte configuration header.
  const payload = (format.includes('compresseddepth') ? image.data.subarray(12) : image.data).slice();
  return new Blob([payload], { type: format.includes('png') ? 'image/png' : 'image/jpeg' });
}
