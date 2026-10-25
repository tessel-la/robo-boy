import { describe, expect, it } from 'vitest';
import { decodeOccupancyGrid, decodePath, MAX_GRID_CELLS, MAX_PATH_POSES } from './navigationMessages';
import { normalizeNavigationOptions } from './navigationOptions';

const header = { frame_id: '/map', stamp: { sec: 2, nanosec: 0 } };
const pose = (x = 1, h = {}) => ({ header: h, pose: { position: { x, y: 2, z: 3 } } });
const grid = (data: unknown = [0, 100, -1, 50]) => ({
  header,
  info: {
    width: 2,
    height: 2,
    resolution: 0.5,
    origin: { position: { x: 10, y: 20, z: 1 }, orientation: { x: 0, y: 0, z: 2, w: 2 } },
  },
  data,
});

describe('navigation message decoding', () => {
  it('honors per-pose frames/timestamps, falls back to the path header, and shares transform requests', () => {
    const path = decodePath({
      header,
      poses: [pose(), pose(2), pose(3, { frame_id: '/odom', stamp: { sec: 0, nanosec: 0 } })],
    });
    expect([...path.points]).toEqual([1, 2, 3, 2, 2, 3, 3, 2, 3]);
    expect([...path.transforms]).toEqual([0, 0, 1]);
    expect(path.requests).toEqual([
      { frameId: 'map', stamp: 2_000_000_000n },
      { frameId: 'odom', stamp: 0n },
    ]);
    expect(decodePath({ poses: [] }).points).toHaveLength(0);
  });

  it('rejects malformed, unframed and oversized paths before creating rendering data', () => {
    expect(() => decodePath({ poses: [pose()] })).toThrow('frame_id');
    expect(() => decodePath({ header, poses: [pose(Infinity)] })).toThrow('coordinates');
    expect(() => decodePath({ header, poses: [pose(1, { stamp: { sec: 1, nanosec: -1 } })] })).toThrow('timestamp');
    expect(() => decodePath({ poses: new Array(MAX_PATH_POSES + 1) })).toThrow('limit');
    expect(() => decodePath(null)).toThrow('array');
  });

  it.each([
    [0, 100, -1, 50],
    new Int8Array([0, 100, -1, 50]),
    new Uint8Array([0, 100, 255, 50]),
    btoa('\x00\x64\xff\x32'),
  ])('decodes JSON, signed/unsigned CBOR and base64 cells without flipping rows', data => {
    const result = decodeOccupancyGrid(grid(data))!;
    expect(result.header).toEqual({ frameId: 'map', stamp: 2_000_000_000n });
    expect([...result.pixels]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 113, 128, 147, 255, 128, 128, 128, 255]);
    expect(result.position.toArray()).toEqual([10, 20, 1]);
    expect(result.rotation.length()).toBeCloseTo(1);
  });

  it('rejects invalid map dimensions, GPU-oversized textures, cell counts/values and origins', () => {
    expect(() => decodeOccupancyGrid(grid(), 1)).toThrow('dimensions');
    expect(() => decodeOccupancyGrid({ ...grid(), info: { ...grid().info, width: MAX_GRID_CELLS } })).toThrow(
      'dimensions'
    );
    expect(() => decodeOccupancyGrid({ ...grid(), info: { ...grid().info, width: 2.5 } })).toThrow('dimensions');
    expect(() => decodeOccupancyGrid(grid([0]))).toThrow('length');
    for (const value of [101, -2, 1.5, NaN])
      expect(() => decodeOccupancyGrid(grid([value, 0, 0, 0]))).toThrow('occupancy');
    expect(() => decodeOccupancyGrid(grid('not base64!'))).toThrow();
    expect(() => decodeOccupancyGrid({ ...grid(), info: { ...grid().info, resolution: 0 } })).toThrow('resolution');
    expect(() => decodeOccupancyGrid({ ...grid(), info: { ...grid().info, origin: {} } })).toThrow('origin');
    expect(decodeOccupancyGrid({ info: { width: 0, height: 0 }, data: [] })).toBeNull();
  });

  it('normalizes persisted options and preserves intentionally invisible layers', () => {
    expect(normalizeNavigationOptions({ visible: false, opacity: 0, lineWidth: -5, color: 'bad' })).toMatchObject({
      visible: false,
      opacity: 0,
      lineWidth: 0.001,
      color: '#22c55e',
    });
    expect(normalizeNavigationOptions({ opacity: NaN }, true).opacity).toBe(0.7);
  });
});
