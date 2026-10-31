import nativeFixture from '../../../e2e/fixtures/cloudini-v6.json';
import { describe, expect, it } from 'vitest';
import { cloudiniMessage } from './cloudiniMessage';
import { decodeCloudini } from './decodeCloudini';
import { decodePointCloud } from '../pointCloudDecoder';

const fixture = () => ({
  ...nativeFixture,
  fields: nativeFixture.fields.map(field => ({ ...field })),
  compressed_data: Uint8Array.from(atob(nativeFixture.compressed_data), c => c.charCodeAt(0)),
});

describe('bounded Cloudini decoding', () => {
  it('decodes the native V6 fixture, preserves acquisition metadata, and uses the existing XYZ decoder', async () => {
    const original = fixture();
    const message = await decodeCloudini(original);
    expect(message.header).toEqual(original.header);
    const output = new Float32Array(9);
    expect(decodePointCloud(message, output)).toBe(2);
    [1.1234, 2.9876, -3.5432, 4, 5, 6].forEach((value, index) => expect(output[index]).toBeCloseTo(value, 3));
  });
  it('handles empty clouds without loading a payload', async () => {
    expect((await decodeCloudini({ ...fixture(), width: 0, row_step: 0, compressed_data: [] })).data).toHaveLength(0);
  });
  it.each([
    { format: 'draco' },
    { is_bigendian: true },
    { width: 1_000_001, row_step: 12_000_012 },
    { row_step: 1 },
    { height: -1 },
    { point_step: 257 },
    { fields: [{ name: 'x', offset: 12, datatype: 7, count: 1 }] },
    { compressed_data: [256] },
    { compressed_data: new Uint8Array(8 * 1024 * 1024 + 1) },
  ])('rejects invalid outer metadata before invoking WASM (case %#)', patch => {
    expect(() => cloudiniMessage({ ...fixture(), ...patch })).toThrow();
  });
  it('rejects inconsistent embedded dimensions/fields and truncated or corrupted data', async () => {
    const original = fixture();
    await expect(decodeCloudini({ ...original, width: 2, row_step: 24 })).rejects.toThrow('Cloudini payload');
    await expect(
      decodeCloudini({ ...original, fields: original.fields.map(f => ({ ...f, offset: (f.offset + 4) % 12 })) })
    ).rejects.toThrow('Cloudini payload');
    await expect(
      decodeCloudini({ ...original, compressed_data: original.compressed_data.slice(0, 8) })
    ).rejects.toThrow('Cloudini payload');
    const corrupt = original.compressed_data.slice();
    corrupt.fill(0, corrupt.length - 5);
    await expect(decodeCloudini({ ...original, compressed_data: corrupt })).rejects.toThrow();
    // A failed packet must not poison subsequent decoding.
    expect((await decodeCloudini(original)).data).toHaveLength(36);
  });
  it.each(['base64', 'array', 'view'])('accepts %s bytes from rosbridge or replay', async kind => {
    const original = fixture();
    const bytes = original.compressed_data;
    const compressed_data =
      kind === 'base64' ? btoa(String.fromCharCode(...bytes)) : kind === 'array' ? [...bytes] : bytes.subarray(0);
    expect((await decodeCloudini({ ...original, compressed_data })).data).toHaveLength(36);
  });
});
