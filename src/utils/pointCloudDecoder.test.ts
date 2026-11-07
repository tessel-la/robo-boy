import { describe, expect, it } from 'vitest';
import { decodePointCloud, type PointCloudMessage } from './pointCloudDecoder';

function cloud(): PointCloudMessage {
  return {
    width: 2,
    height: 2,
    point_step: 12,
    row_step: 32,
    is_bigendian: false,
    fields: ['x', 'y', 'z'].map((name, i) => ({ name, offset: i * 4, datatype: 7, count: 1 })),
    data: new Uint8Array(64),
  };
}
function fill(m: PointCloudMessage, values = [1, 2, 3, 4]) {
  const data = m.data as Uint8Array;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  values.forEach((x, i) => {
    const base = Math.floor(i / m.width) * m.row_step + (i % m.width) * m.point_step;
    for (const field of m.fields) {
      const value = x + ['x', 'y', 'z'].indexOf(field.name) * 10;
      const offset = base + field.offset;
      if (field.datatype === 8) v.setFloat64(offset, value, !m.is_bigendian);
      else if (field.datatype === 3) v.setInt16(offset, value, !m.is_bigendian);
      else v.setFloat32(offset, value, !m.is_bigendian);
    }
  });
}

describe('PointCloud2 metadata decoder', () => {
  it.each([false, true])('honors organized-row padding, field offsets and big-endian=%s', big => {
    const m = cloud();
    m.is_bigendian = big;
    m.fields = [
      { name: 'x', offset: 8, datatype: 3, count: 1 },
      { name: 'y', offset: 0, datatype: 7, count: 1 },
      { name: 'z', offset: 12, datatype: 8, count: 1 },
    ];
    m.point_step = 24;
    m.row_step = 56;
    m.data = new Uint8Array(112);
    fill(m);
    const output = new Float32Array(12);
    expect(decodePointCloud(m, output)).toBe(4);
    expect([...output]).toEqual([1, 11, 21, 2, 12, 22, 3, 13, 23, 4, 14, 24]);
  });

  it.each(['array', 'view', 'buffer', 'base64'])('accepts %s payloads including replay byte arrays', kind => {
    const m = cloud();
    fill(m);
    const bytes = m.data as Uint8Array;
    const padded = new Uint8Array(72);
    padded.set(bytes, 4);
    m.data =
      kind === 'array'
        ? [...bytes]
        : kind === 'view'
          ? padded.subarray(4, 68)
          : kind === 'buffer'
            ? bytes.buffer
            : btoa(String.fromCharCode(...bytes));
    const output = new Float32Array(3);
    expect(decodePointCloud(m, output)).toBe(1);
    expect([...output]).toEqual([1, 11, 21]);
  });

  it('compacts nonfinite samples and caps work at the output capacity', () => {
    const m = cloud();
    fill(m, [Number.NaN, 2, Number.POSITIVE_INFINITY, 4]);
    const output = new Float32Array(12);
    expect(decodePointCloud(m, output)).toBe(2);
    expect([...output.slice(0, 6)]).toEqual([2, 12, 22, 4, 14, 24]);
    expect(decodePointCloud(m, new Float32Array(3))).toBe(0);
  });

  it('rejects malformed layouts before touching the output', () => {
    const output = new Float32Array([9, 9, 9]);
    const m = cloud();
    fill(m);
    for (const patch of [
      { row_step: 1 },
      { point_step: 0 },
      { width: -1 },
      { data: new Uint8Array(2) },
      { fields: [] },
      { fields: [{ name: 'x', offset: 0, datatype: 99, count: 1 }] },
      { fields: m.fields.map(f => ({ ...f, offset: 100 })) },
      { fields: m.fields.map(f => ({ ...f, count: 2 })) },
      { data: [-1, 256] },
    ]) {
      expect(() => decodePointCloud({ ...m, ...patch }, output)).toThrow();
      expect([...output]).toEqual([9, 9, 9]);
    }
  });
});
