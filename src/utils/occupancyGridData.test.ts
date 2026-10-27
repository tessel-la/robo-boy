import { expect, it } from 'vitest';
import { applyGridUpdate, decodeGrid, gridPixels } from './occupancyGridData';
const header = (sec = 2, frame_id = 'map', seq?: number) => ({
  frame_id,
  stamp: { sec, nanosec: 0 },
  ...(seq === undefined ? {} : { seq }),
});
const full = () => ({
  header: header(),
  info: {
    width: 3,
    height: 2,
    resolution: 0.5,
    origin: { position: { x: 1, y: 2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  },
  data: [0, 0, 0, 0, 0, 0],
});
const patch = (extra: object = {}) => ({
  header: header(3),
  x: 1,
  y: 0,
  width: 2,
  height: 2,
  data: [1, 99, 100, -1],
  ...extra,
});
it('applies rectangular patches in ROS row order and preserves all untouched cells', () => {
  const grid = decodeGrid(full())!;
  expect(applyGridUpdate(grid, patch())).toBe(true);
  expect([...grid.cells]).toEqual([0, 1, 99, 0, 100, -1]);
  expect(grid.header.stamp).toBe(3_000_000_000n);
  expect(grid.baseStamp).toBe(2_000_000_000n);
});
it.each([new Int8Array([1, 99, 100, -1]), new Uint8Array([1, 99, 100, 255]), btoa('\x01\x63\x64\xff')])(
  'accepts rosbridge byte encodings for updates',
  data => {
    const grid = decodeGrid(full())!;
    applyGridUpdate(grid, patch({ data }));
    expect([...grid.cells]).toEqual([0, 1, 99, 0, 100, -1]);
  }
);
it.each([
  { x: -1 },
  { x: 3 },
  { width: 3 },
  { height: 4 },
  { x: 0.5 },
  { data: [1] },
  { data: [1, 99, 101, -1] },
  { header: header(3, 'odom') },
  { header: header(3, 'map', -1) },
  { width: 0, height: 1, data: [] },
])('rejects malformed patches atomically: %j', invalid => {
  const grid = decodeGrid(full())!;
  expect(() => applyGridUpdate(grid, patch(invalid))).toThrow();
  expect([...grid.cells]).toEqual([0, 0, 0, 0, 0, 0]);
});
it('ignores old-baseline patches, rejects out-of-order patches and keeps the timestamp watermark through unstamped updates', () => {
  const grid = decodeGrid(full())!;
  expect(applyGridUpdate(grid, patch({ header: header(1) }))).toBe(false);
  applyGridUpdate(grid, patch({ header: header(5) }));
  applyGridUpdate(grid, patch({ header: header(0) }));
  expect(() => applyGridUpdate(grid, patch({ header: header(4) }))).toThrow('out of order');
});
it('detects ROS 1 sequence gaps, ignores duplicates and accepts uint32 wraparound', () => {
  const grid = decodeGrid(full())!;
  applyGridUpdate(grid, patch({ header: header(3, 'map', 0xffffffff) }));
  expect(applyGridUpdate(grid, patch({ header: header(3, 'map', 0xffffffff) }))).toBe(false);
  applyGridUpdate(grid, patch({ header: header(4, 'map', 0) }));
  expect(() => applyGridUpdate(grid, patch({ header: header(5, 'map', 2) }))).toThrow('gap');
  expect(decodeGrid(full())!.sequence).toBeUndefined();
});
it('uses RViz costmap colors, including transparent free space, and recolors only the dirty rectangle', () => {
  const pixels = gridPixels(new Int8Array([0, 1, 98, 99, 100, -1]), 'costmap');
  expect([...pixels]).toEqual([
    0, 0, 0, 0, 2, 0, 253, 255, 249, 0, 6, 255, 0, 255, 255, 255, 255, 0, 255, 255, 112, 137, 134, 255,
  ]);
  const output = new Uint8Array(24).fill(42);
  gridPixels(new Int8Array([0, 1, 98, 99, 100, -1]), 'costmap', output, { x: 1, y: 1, width: 2, height: 1, stride: 3 });
  expect([...output.slice(0, 16)]).toEqual(Array(16).fill(42));
  expect([...output.slice(16)]).toEqual([255, 0, 255, 255, 112, 137, 134, 255]);
});
