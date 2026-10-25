import * as THREE from 'three';
import { rosStamp } from './tfHistory';

export const MAX_PATH_POSES = 10_000;
export const MAX_GRID_CELLS = 4_194_304;
export const MAX_GRID_SIDE = 4096;

export function navigationHeader(header: any, fallback?: any) {
  const rawFrame =
    typeof header?.frame_id === 'string' && header.frame_id.trim() ? header.frame_id : fallback?.frame_id;
  const frameId = typeof rawFrame === 'string' ? rawFrame.trim().replace(/^\/+/, '') : '';
  const stamp = rosStamp(header?.stamp === undefined ? fallback?.stamp : header.stamp);
  if (!frameId) throw new Error('Message frame_id is missing.');
  if (stamp === null) throw new Error('Message timestamp is invalid.');
  return { frameId, stamp };
}

export function decodePath(message: any) {
  if (!Array.isArray(message?.poses)) throw new Error('Path poses must be an array.');
  if (message.poses.length > MAX_PATH_POSES)
    throw new Error(`Path exceeds the ${MAX_PATH_POSES.toLocaleString('en-US')}-pose limit.`);
  const requests: ReturnType<typeof navigationHeader>[] = [];
  const indices = new Map<string, number>();
  const points = new Float64Array(message.poses.length * 3);
  const transforms = new Uint32Array(message.poses.length);
  message.poses.forEach((pose: any, i: number) => {
    const p = pose?.pose?.position;
    if (![p?.x, p?.y, p?.z].every(Number.isFinite)) throw new Error(`Path pose ${i + 1} contains invalid coordinates.`);
    const header = navigationHeader(pose.header, message.header);
    const key = JSON.stringify([header.frameId, header.stamp.toString()]);
    let index = indices.get(key);
    if (index === undefined) {
      index = requests.length;
      indices.set(key, index);
      requests.push(header);
    }
    points.set([p.x, p.y, p.z], i * 3);
    transforms[i] = index;
  });
  return { points, transforms, requests };
}

export function decodeOccupancyGrid(message: any, maxTextureSize = MAX_GRID_SIDE) {
  const info = message?.info;
  const width = info?.width,
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
  ) {
    throw new Error(
      `Invalid map dimensions (maximum ${limit} per side and ${MAX_GRID_CELLS.toLocaleString('en-US')} cells).`
    );
  }
  const count = width * height;
  if ((width === 0) !== (height === 0)) throw new Error('Empty maps must have both dimensions zero.');
  let data: ArrayLike<number> = message.data;
  if (typeof message.data === 'string') {
    if (message.data.length > Math.ceil(count / 3) * 4)
      throw new Error('Map data length does not match its dimensions.');
    let binary: string;
    try {
      binary = atob(message.data);
    } catch {
      throw new Error('Map data is not valid base64.');
    }
    data = Uint8Array.from(binary, c => c.charCodeAt(0));
  }
  if (
    (!Array.isArray(data) && !(data instanceof Int8Array) && !(data instanceof Uint8Array)) ||
    data.length !== count
  ) {
    throw new Error('Map data length does not match its dimensions.');
  }
  if (!count) return null;
  const header = navigationHeader(message.header);
  const p = info.origin?.position,
    q = info.origin?.orientation;
  if (
    !Number.isFinite(resolution) ||
    resolution <= 0 ||
    !Number.isFinite(Math.fround(width * resolution)) ||
    !Number.isFinite(Math.fround(height * resolution)) ||
    ![p?.x, p?.y, p?.z, q?.x, q?.y, q?.z, q?.w].every(Number.isFinite) ||
    ![p.x, p.y, p.z].every(value => Number.isFinite(Math.fround(value)))
  )
    throw new Error('Map resolution or origin is invalid.');
  const rotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(rotation.lengthSq()) || rotation.lengthSq() < 1e-12)
    throw new Error('Map origin orientation is invalid.');
  rotation.normalize();
  const pixels = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const value = data[i];
    if (!Number.isInteger(value) || (value !== -1 && value !== 255 && (value < 0 || value > 100))) {
      throw new Error(`Invalid occupancy value at cell ${i}: expected -1 or 0–100.`);
    }
    const unknown = value === -1 || value === 255;
    const shade = Math.round(255 * (1 - value / 100));
    const offset = i * 4;
    pixels[offset] = unknown ? 113 : shade;
    pixels[offset + 1] = unknown ? 128 : shade;
    pixels[offset + 2] = unknown ? 147 : shade;
    pixels[offset + 3] = 255;
  }
  return { width, height, resolution, header, pixels, position: new THREE.Vector3(p.x, p.y, p.z), rotation };
}
