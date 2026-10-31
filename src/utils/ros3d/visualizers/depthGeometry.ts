import * as THREE from 'three';
import type { DepthFrame } from '../../images/depthFrames';
import { depthIntensity } from '../../images/depthFrames';

export const MAX_DEPTH_POINTS = 100_000;

/** Sample a bounded pixel grid; never join discontinuities with fabricated surfaces. */
export function updateDepthGeometry(
  geometry: THREE.BufferGeometry,
  depth: DepthFrame,
  unitCorners: number[][],
  maxRange: number
) {
  const { width, height, metres } = depth;
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_DEPTH_POINTS)));
  const capacity = Math.min(MAX_DEPTH_POINTS, Math.ceil(width / stride) * Math.ceil(height / stride));
  let position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  let color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!position || position.count !== capacity) {
    // Three.js releases replaced attribute buffers on the geometry disposal event.
    geometry.dispose();
    position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', color);
  }
  const origin = unitCorners[0],
    right = unitCorners[1],
    down = unitCorners[3];
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  let count = 0;
  for (let y = 0; y < height && count < capacity; y += stride) {
    for (let x = 0; x < width && count < capacity; x += stride) {
      const z = metres[y * width + x];
      if (!(z > 0) || !Number.isFinite(z) || z > maxRange) continue;
      // ROS pixel centres use integer coordinates. R^-1 is already represented in the corner rays.
      point.set(
        (origin[0] + ((right[0] - origin[0]) * x) / width + ((down[0] - origin[0]) * y) / height) * z,
        (origin[1] + ((right[1] - origin[1]) * x) / width + ((down[1] - origin[1]) * y) / height) * z,
        (origin[2] + ((right[2] - origin[2]) * x) / width + ((down[2] - origin[2]) * y) / height) * z
      );
      if (
        !Number.isFinite(Math.fround(point.x)) ||
        !Number.isFinite(Math.fround(point.y)) ||
        !Number.isFinite(Math.fround(point.z))
      )
        continue;
      position.setXYZ(count, point.x, point.y, point.z);
      const srgb = depthIntensity(z) / 255;
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      color!.setXYZ(count, linear, linear, linear);
      bounds.expandByPoint(point);
      count++;
    }
  }
  position.needsUpdate = color!.needsUpdate = true;
  geometry.setDrawRange(0, count);
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
}
