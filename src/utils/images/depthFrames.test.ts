// @vitest-environment node
import { expect, it } from 'vitest';
import { depthPreview, rawDepthFrame } from './depthFrames';
import { decodeImageFrame } from './decodeImage';

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function chunk(type: string, payload: Uint8Array) {
  const data = concat([new TextEncoder().encode(type), payload]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = new Uint8Array(4),
    checksum = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length);
  new DataView(checksum.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0);
  return concat([length, data, checksum]);
}
async function png(width: number, height: number, filtered: Uint8Array) {
  const ihdr = new Uint8Array(13),
    view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 16;
  const stream = new Blob([filtered.slice()]).stream().pipeThrough(new CompressionStream('deflate'));
  const encoded = new Uint8Array(await new Response(stream).arrayBuffer());
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', encoded),
    chunk('IEND', new Uint8Array()),
  ]);
}
const compressed = (pngBytes: Uint8Array, a = 0, b = 0) => {
  const header = new Uint8Array(12),
    view = new DataView(header.buffer);
  view.setFloat32(4, a, true);
  view.setFloat32(8, b, true);
  return concat([header, pngBytes]);
};

it('preserves millimetre depth with row padding, byte offsets and either byte order', async () => {
  for (const is_bigendian of [false, true]) {
    const backing = new Uint8Array(40),
      data = backing.subarray(3, 27),
      view = new DataView(data.buffer, data.byteOffset);
    [1000, 0, 2500, 65535].forEach((v, i) => view.setUint16(Math.floor(i / 2) * 8 + (i % 2) * 2, v, !is_bigendian));
    const image = { width: 2, height: 2, step: 8, encoding: '16UC1', is_bigendian, data };
    expect([...rawDepthFrame(image).metres]).toEqual([1, 0, 2.5, expect.closeTo(65.535, 4)]);
    const decoded = await decodeImageFrame(image, 'sensor_msgs/msg/Image');
    expect(decoded.depth?.metres[0]).toBe(1);
    expect('data' in decoded.image && decoded.image.data[0]).toBe(230);
  }
});
it('retains float metres and discards non-finite, zero and negative ranges', () => {
  for (const is_bigendian of [false, true]) {
    const data = new Uint8Array(24),
      view = new DataView(data.buffer);
    [1.25, NaN, Infinity, -1, 0, 3.5].forEach((v, i) => view.setFloat32(i * 4, v, !is_bigendian));
    expect([...rawDepthFrame({ width: 3, height: 2, step: 12, encoding: '32FC1', is_bigendian, data }).metres]).toEqual(
      [1.25, 0, 0, 0, 0, 3.5]
    );
  }
  expect(() => rawDepthFrame({ width: 2, height: 2, step: 3, encoding: '16UC1', data: new Uint8Array(8) })).toThrow(
    'truncated'
  );
  expect(() =>
    rawDepthFrame({ width: 9000, height: 1, step: 18000, encoding: '16UC1', data: new Uint8Array(0) })
  ).toThrow('limit');
});
it('keeps a stable metric preview, with black invalid pixels and saturation beyond 10 m', () => {
  const a = depthPreview({ width: 4, height: 1, metres: new Float32Array([0, 1, 5, 20]) });
  expect([...a.data].filter((_, i) => i % 4 === 0)).toEqual([0, 230, 128, 1]);
  const b = depthPreview({ width: 1, height: 1, metres: new Float32Array([1]) });
  expect(b.data[0]).toBe(a.data[4]);
});
it('decodes 16-bit PNG without truncating low bytes and restores float inverse-depth quantization', async () => {
  const payload = await png(3, 1, new Uint8Array([0, 0x03, 0xe8, 0, 0, 0x09, 0xc4]));
  const frame = await decodeImageFrame(
    { format: '16UC1; compressedDepth png', data: compressed(payload) },
    'sensor_msgs/CompressedImage'
  );
  expect([...frame.depth!.metres]).toEqual([1, 0, 2.5]);
  const floats = await decodeImageFrame(
    { format: '32FC1; compressedDepth png', data: compressed(payload, 1000, -100) },
    'sensor_msgs/CompressedImage'
  );
  expect(floats.depth!.metres[0]).toBeCloseTo(1000 / 1100);
  expect(floats.depth!.metres[1]).toBe(0);
  expect(floats.depth!.metres[2]).toBeCloseTo(1000 / 2600);
});
it.each([0, 1, 2, 3, 4])('reconstructs PNG filter %i including the previous-row predictor', async filter => {
  const row = [3, 232, 9, 196],
    previous = [1, 244, 7, 208];
  const filtered = row.map((byte, x) => {
    const l = row[x - 2] ?? 0,
      a = previous[x],
      c = previous[x - 2] ?? 0;
    const p = l + a - c,
      dl = Math.abs(p - l),
      da = Math.abs(p - a),
      dc = Math.abs(p - c);
    const predictor = [0, l, a, Math.floor((l + a) / 2), dl <= da && dl <= dc ? l : da <= dc ? a : c][filter];
    return (byte - predictor + 256) % 256;
  });
  const frame = await decodeImageFrame(
    {
      format: '16UC1; compressedDepth',
      data: compressed(await png(2, 2, new Uint8Array([0, ...previous, filter, ...filtered]))),
    },
    'sensor_msgs/CompressedImage'
  );
  expect([...frame.depth!.metres]).toEqual([0.5, 2, 1, 2.5]);
});
it('rejects bombs, truncated PNG, invalid CRC, unsupported formats and quantization', async () => {
  const decode = (data: Uint8Array, format = '16UC1; compressedDepth png') =>
    decodeImageFrame({ format, data }, 'sensor_msgs/CompressedImage');
  await expect(decode(compressed(await png(9000, 1, new Uint8Array())))).rejects.toThrow('limit');
  await expect(decode(compressed(await png(1, 1, new Uint8Array(100000))))).rejects.toThrow();
  await expect(decode(compressed(await png(1, 1, new Uint8Array([0, 1]))))).rejects.toThrow();
  const corrupted = compressed(await png(1, 1, new Uint8Array([0, 1, 0])));
  corrupted[corrupted.length - 1] ^= 1;
  await expect(decode(corrupted)).rejects.toThrow();
  await expect(decode(corrupted.subarray(0, 24))).rejects.toThrow();
  await expect(decode(corrupted, '16UC1; compressedDepth rvl')).rejects.toThrow();
  await expect(decode(corrupted, '32FC1; compressedDepth png')).rejects.toThrow('quantization');
});
