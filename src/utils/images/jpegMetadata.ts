import { MAX_IMAGE_BYTES } from './imageFrames';
import type { DecodedImageFrame } from './decodeImage';

// APP15 payload emitted by Robo-Boy's web_video_server overlay. Ordinary JPEG decoders ignore it.
const SIGNATURE = 'RBROS001';
const NO_METADATA = 'Camera stream has no ROS acquisition metadata.';
export type JpegMetadata = Pick<DecodedImageFrame, 'header' | 'sourceSize' | 'projectionError'>;

export function jpegMetadata(bytes: Uint8Array): JpegMetadata {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Camera frame exceeds the image byte limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let found: JpegMetadata | undefined;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Camera stream frame is not JPEG.');
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('Camera JPEG marker is invalid.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error('Camera JPEG is truncated.');
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('Camera JPEG is truncated.');
    const start = offset + 2;
    if (marker === 0xef && length >= 10 && String.fromCharCode(...bytes.subarray(start, start + 8)) === SIGNATURE) {
      if (found || length < 27 || length > 538) throw new Error('Camera acquisition metadata is invalid.');
      const sec = view.getUint32(start + 8),
        nanosec = view.getUint32(start + 12);
      const width = view.getUint32(start + 16),
        height = view.getUint32(start + 20);
      const frame_id = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start + 24, offset + length));
      if (!width || !height || width > 32768 || height > 32768)
        throw new Error('Camera source dimensions are invalid.');
      if (
        sec > 0x7fffffff ||
        nanosec >= 1e9 ||
        !frame_id.trim() ||
        [...frame_id].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw new Error('Camera acquisition metadata is invalid.');
      found = { header: { frame_id, stamp: { sec, nanosec } }, sourceSize: { width, height } };
    }
    offset += length;
  }
  return found ?? { projectionError: NO_METADATA };
}
