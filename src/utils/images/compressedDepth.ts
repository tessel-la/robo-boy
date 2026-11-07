import { checkImageDimensions, MAX_IMAGE_BYTES } from './imageFrames';
import type { DepthFrame } from './depthFrames';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const invalid = () => new Error('Compressed depth requires a valid non-interlaced 16-bit grayscale PNG.');

/** Browser image decoders truncate PNG to eight bits. Decode the ROS depth transport losslessly. */
export async function decodeCompressedDepth(data: Uint8Array, format: string): Promise<DepthFrame> {
  const match = /^(16UC1|32FC1);\s*compressedDepth(?:\s+png)?$/i.exec(format.trim());
  if (!match) throw new Error('Depth transport supports 16UC1 or 32FC1 compressedDepth PNG; RVL is unsupported.');
  if (data.length < 45 || data.length > MAX_IMAGE_BYTES) throw invalid();
  const header = new DataView(data.buffer, data.byteOffset, 12);
  const floating = match[1].toLowerCase() === '32fc1';
  const a = header.getFloat32(4, true),
    b = header.getFloat32(8, true);
  if (floating && (header.getInt32(0, true) !== 0 || !Number.isFinite(a) || a <= 0 || !Number.isFinite(b)))
    throw new Error('Compressed depth quantization header is invalid.');
  const png = data.subarray(12);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) throw invalid();
  let offset = 8,
    width = 0,
    height = 0,
    ended = false,
    idatEnded = false;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let chunks = 0; offset < png.length && chunks < 4096; chunks++) {
    if (offset + 12 > png.length) throw invalid();
    const length = view.getUint32(offset),
      kind = view.getUint32(offset + 4);
    if (
      length > png.length - offset - 12 ||
      crc(png.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)
    )
      throw invalid();
    const start = offset + 8;
    if (offset === 8 && kind !== 0x49484452) throw invalid();
    if (kind === 0x49484452) {
      // IHDR
      if (offset !== 8 || length !== 13) throw invalid();
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      checkImageDimensions(width, height);
      if (
        png[start + 8] !== 16 ||
        png[start + 9] !== 0 ||
        png[start + 10] !== 0 ||
        png[start + 11] !== 0 ||
        png[start + 12] !== 0
      )
        throw invalid();
    } else if (kind === 0x49444154) {
      // IDAT
      if (idatEnded) throw invalid();
      parts.push(png.slice(start, start + length));
    } else if (kind === 0x49454e44) {
      // IEND
      if (length || !parts.length || start + 4 !== png.length) throw invalid();
      ended = true;
      break;
    } else {
      if (!(png[offset + 4] & 32)) throw invalid(); // Unknown critical chunk
      if (parts.length) idatEnded = true;
    }
    offset += length + 12;
  }
  if (!ended || !width || !height || typeof DecompressionStream === 'undefined') throw invalid();
  const rowBytes = width * 2,
    expected = (rowBytes + 1) * height;
  const filtered = new Uint8Array(expected);
  const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > expected - written) throw invalid();
      filtered.set(value, written);
      written += value.length;
    }
    if (written !== expected) throw invalid();
  } finally {
    await reader.cancel();
  }
  const metres = new Float32Array(width * height);
  let previous = new Uint8Array(rowBytes),
    row = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const start = y * (rowBytes + 1),
      filter = filtered[start];
    if (filter > 4) throw invalid();
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= 2 ? row[x - 2] : 0,
        above = previous[x],
        corner = x >= 2 ? previous[x - 2] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - corner;
        const da = Math.abs(p - left),
          db = Math.abs(p - above),
          dc = Math.abs(p - corner);
        predictor = da <= db && da <= dc ? left : db <= dc ? above : corner;
      }
      row[x] = filtered[start + 1 + x] + predictor;
    }
    for (let x = 0; x < width; x++) {
      const code = row[x * 2] * 256 + row[x * 2 + 1];
      const value = floating ? a / (code - b) : code / 1000;
      if (code && value > 0 && Number.isFinite(value) && Number.isFinite(Math.fround(value)))
        metres[y * width + x] = value;
    }
    [previous, row] = [row, previous];
  }
  return { width, height, metres };
}
