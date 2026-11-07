import { depthPreview, isDepthEncoding, rawDepthFrame, type DepthFrame } from './depthFrames';
import {
  checkImageDimensions,
  COMPRESSED_IMAGE_TYPES,
  compressedImageBlob,
  messageBytes,
  rawImageToRgba,
  type RgbaFrame,
} from './imageFrames';

export interface DecodedImageFrame {
  /** Owned by the decoder caller; shared-stream consumers use SharedImageFrame.retain(). */
  image: ImageBitmap | RgbaFrame;
  header?: { frame_id?: string; stamp?: unknown };
  /** Original acquisition header when projection explicitly uses a synthetic latest-TF header. */
  acquisitionHeader?: { frame_id?: string; stamp?: unknown };
  encoding: string;
  /** Shared immutable metric measurements, independent of the display preview. */
  depth?: DepthFrame;
  /** Full-frame source size before streamer resizing; cropping/rotation is unsupported. */
  sourceSize?: { width: number; height: number };
  projectionError?: string;
}

/** Validate encoded dimensions before handing allocation to the browser's image decoder. */
export function encodedDimensions(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(12) === 0x49484452
  ) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  throw new Error('Only valid JPEG and PNG compressed images are supported.');
}

export async function decodeImageFrame(message: any, type: string): Promise<DecodedImageFrame> {
  if (!message || typeof message !== 'object') throw new Error('Image message is invalid.');
  const data = messageBytes(message.data);
  if (!COMPRESSED_IMAGE_TYPES.includes(type)) {
    const depth = isDepthEncoding(message.encoding) ? rawDepthFrame({ ...message, data }) : undefined;
    return {
      image: depth ? depthPreview(depth) : rawImageToRgba({ ...message, data }),
      depth,
      header: message.header,
      encoding: message.encoding,
    };
  }
  const format = typeof message.format === 'string' ? message.format : '';
  if (format.length > 512 || /compresseddepth.*rvl/i.test(format))
    throw new Error('Compressed image format is unsupported.');
  if (/compresseddepth/i.test(format)) {
    const { decodeCompressedDepth } = await import('./compressedDepth');
    const depth = await decodeCompressedDepth(data, format);
    return { image: depthPreview(depth), depth, header: message.header, encoding: format };
  }
  const payload = data;
  const [width, height] = encodedDimensions(payload);
  checkImageDimensions(width, height);
  const image = await createImageBitmap(compressedImageBlob({ format, data }), {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (image.width !== width || image.height !== height) {
    image.close();
    throw new Error('Decoded image dimensions do not match its header.');
  }
  return { image, header: message.header, encoding: format };
}
