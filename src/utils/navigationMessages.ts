import * as THREE from 'three';
import { navigationHeader } from './navigationHeader';
import { decodeGrid, gridPixels, MAX_GRID_SIDE, type GridPalette } from './occupancyGridData';
export { navigationHeader } from './navigationHeader';
export { MAX_GRID_CELLS, MAX_GRID_SIDE } from './occupancyGridData';

export const MAX_PATH_POSES = 10_000;

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

export function decodeOccupancyGrid(
  message: unknown,
  maxTextureSize = MAX_GRID_SIDE,
  palette: GridPalette = 'occupancy'
) {
  const grid = decodeGrid(message, maxTextureSize);
  if (!grid) return null;
  return {
    ...grid,
    pixels: gridPixels(grid.cells, palette),
    position: new THREE.Vector3(...grid.position),
    rotation: new THREE.Quaternion(...grid.rotation),
  };
}
