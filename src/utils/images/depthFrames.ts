import { checkImageDimensions, MAX_IMAGE_BYTES, type RawImage, type RgbaFrame } from './imageFrames';

/** ROS REP 118: axial depth in metres; zero represents an invalid measurement. */
export interface DepthFrame {
  width: number;
  height: number;
  metres: Float32Array;
}
export const DEPTH_DISPLAY_RANGE = 10;
/** Near measurements stay visible against a dark 3D scene; zero is reserved for invalid pixels. */
export const depthIntensity = (metres: number) =>
  metres > 0 ? Math.max(1, Math.round((1 - Math.min(1, metres / DEPTH_DISPLAY_RANGE)) * 255)) : 0;
export const isDepthEncoding = (encoding: unknown) =>
  typeof encoding === 'string' && ['16uc1', '32fc1'].includes(encoding.toLowerCase());

export function rawDepthFrame(image: RawImage): DepthFrame {
  const { width, height, step, data } = image;
  checkImageDimensions(width, height);
  if (!isDepthEncoding(image.encoding)) throw new Error('Depth requires 16UC1 (millimetres) or 32FC1 (metres).');
  const floating = image.encoding.toLowerCase() === '32fc1';
  const bytes = floating ? 4 : 2;
  if (
    !Number.isSafeInteger(step) ||
    step < width * bytes ||
    step * (height - 1) + width * bytes > data.length ||
    data.length > MAX_IMAGE_BYTES
  )
    throw new Error('Depth image is empty or truncated.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const metres = new Float32Array(width * height);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const offset = y * step + x * bytes;
      const value = floating
        ? view.getFloat32(offset, !image.is_bigendian)
        : view.getUint16(offset, !image.is_bigendian) / 1000;
      if (Number.isFinite(value) && value > 0) metres[i] = value;
    }
  }
  return { width, height, metres };
}

/** Fixed metric scale avoids brightness pumping when a nearby object enters the frame. */
export function depthPreview(depth: DepthFrame): RgbaFrame {
  const data = new Uint8ClampedArray(depth.metres.length * 4);
  for (let i = 0; i < depth.metres.length; i++) {
    const value = depth.metres[i];
    const grey = depthIntensity(value);
    const offset = i * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = grey;
    data[offset + 3] = 255;
  }
  return { width: depth.width, height: depth.height, data };
}
