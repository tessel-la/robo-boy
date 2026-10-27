import { navigationHeader } from './navigationHeader';

export const MAX_GRID_CELLS = 4_194_304;
export const MAX_GRID_SIDE = 4096;
export const GRID_UPDATE_TYPES = ['map_msgs/OccupancyGridUpdate', 'map_msgs/msg/OccupancyGridUpdate'];
export type GridPalette = 'occupancy' | 'costmap';
export interface GridData {
  width: number;
  height: number;
  resolution: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  header: ReturnType<typeof navigationHeader>;
  baseStamp: bigint;
  sequence?: number;
  cells: Int8Array;
}

function cellsFrom(raw: unknown, count: number): Int8Array {
  let data = raw;
  if (typeof data === 'string') {
    if (data.length > Math.ceil(count / 3) * 4) throw new Error('Map data length does not match its dimensions.');
    try {
      data = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    } catch {
      throw new Error('Map data is not valid base64.');
    }
  }
  if ((!Array.isArray(data) && !(data instanceof Int8Array) && !(data instanceof Uint8Array)) || data.length !== count)
    throw new Error('Map data length does not match its dimensions.');
  const result = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    const value = data[i];
    if (!Number.isInteger(value) || (value !== -1 && value !== 255 && (value < 0 || value > 100)))
      throw new Error(`Invalid occupancy value at cell ${i}: expected -1 or 0–100.`);
    result[i] = value === 255 ? -1 : value;
  }
  return result;
}

export function decodeGrid(message: any, maxTextureSize = MAX_GRID_SIDE): GridData | null {
  const info = message?.info,
    width = info?.width,
    height = info?.height,
    resolution = info?.resolution;
  const limit = Math.min(MAX_GRID_SIDE, maxTextureSize);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0 ||
    width > limit ||
    height > limit ||
    width * height > MAX_GRID_CELLS
  )
    throw new Error(
      `Invalid map dimensions (maximum ${limit} per side and ${MAX_GRID_CELLS.toLocaleString('en-US')} cells).`
    );
  if ((width === 0) !== (height === 0)) throw new Error('Empty maps must have both dimensions zero.');
  const cells = cellsFrom(message.data, width * height);
  if (!cells.length) return null;
  const header = navigationHeader(message.header),
    p = info.origin?.position,
    q = info.origin?.orientation;
  if (
    !Number.isFinite(resolution) ||
    resolution <= 0 ||
    !Number.isFinite(Math.fround(width * resolution)) ||
    !Number.isFinite(Math.fround(height * resolution)) ||
    ![p?.x, p?.y, p?.z, q?.x, q?.y, q?.z, q?.w].every(Number.isFinite) ||
    ![p.x, p.y, p.z].every(v => Number.isFinite(Math.fround(v)))
  )
    throw new Error('Map resolution or origin is invalid.');
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length < 1e-6) throw new Error('Map origin orientation is invalid.');
  return {
    width,
    height,
    resolution,
    header,
    baseStamp: header.stamp,
    cells,
    position: [p.x, p.y, p.z],
    rotation: [q.x / length, q.y / length, q.z / length, q.w / length],
  };
}

/** Validate the complete patch before changing any cells. ROS 2 headers have no sequence counter. */
export function applyGridUpdate(grid: GridData, update: any): boolean {
  const header = navigationHeader(update?.header);
  if (header.frameId !== grid.header.frameId) throw new Error('Map update frame does not match the full map.');
  if (header.stamp && grid.baseStamp && header.stamp < grid.baseStamp) return false;
  if (header.stamp && grid.header.stamp && header.stamp < grid.header.stamp)
    throw new Error('Map updates arrived out of order.');
  const { x, y, width, height } = update;
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    x < 0 ||
    y < 0 ||
    width < 0 ||
    height < 0 ||
    x + width > grid.width ||
    y + height > grid.height ||
    (width === 0) !== (height === 0)
  )
    throw new Error('Map update rectangle is outside the full map.');
  const cells = cellsFrom(update.data, width * height);
  const seq = update.header?.seq;
  if (seq !== undefined && (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff))
    throw new Error('Map update sequence is invalid.');
  if (seq !== undefined && seq === grid.sequence) return false;
  if (seq !== undefined && grid.sequence !== undefined && seq !== (grid.sequence + 1) >>> 0)
    throw new Error('Map update sequence has a gap.');
  for (let row = 0; row < height; row++)
    grid.cells.set(cells.subarray(row * width, (row + 1) * width), (y + row) * grid.width + x);
  grid.sequence = seq;
  // Zero stamps must not erase the monotonic watermark of stamped updates.
  if (header.stamp) grid.header = header;
  return !!cells.length;
}

/** Occupancy colors preserve existing maps. Costmap values follow RViz's published 0–100 convention. */
export function gridPixels(
  cells: Int8Array,
  palette: GridPalette,
  pixels: Uint8Array<ArrayBuffer> = new Uint8Array(cells.length * 4),
  region?: { x: number; y: number; width: number; height: number; stride: number }
): Uint8Array<ArrayBuffer> {
  const width = region?.width ?? cells.length,
    height = region?.height ?? 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = region ? (region.y + y) * region.stride + region.x + x : x;
      const value = cells[i],
        offset = i * 4;
      let r: number,
        g: number,
        b: number,
        a = 255;
      if (value === -1) [r, g, b] = palette === 'costmap' ? [112, 137, 134] : [113, 128, 147];
      else if (palette === 'occupancy') r = g = b = Math.round(255 * (1 - value / 100));
      else if (value === 0) {
        r = g = b = a = 0;
      } else if (value === 99) [r, g, b] = [0, 255, 255];
      else if (value === 100) [r, g, b] = [255, 0, 255];
      else {
        r = Math.floor((255 * value) / 100);
        g = 0;
        b = 255 - r;
      }
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = a;
    }
  return pixels;
}
