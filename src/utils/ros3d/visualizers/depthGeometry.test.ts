import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { updateDepthGeometry, MAX_DEPTH_POINTS } from './depthGeometry';
import { cameraPlaneCorners, parseCameraInfo } from '../../images/cameraCalibration';

it('applies ROI/binning and inverse rectification to pixel-centre rays without double-applying stereo baseline', () => {
  const c = parseCameraInfo({
    header: { frame_id: 'optical' },
    width: 8,
    height: 8,
    k: [8, 0, 4, 0, 8, 4, 0, 0, 1],
    p: [8, 0, 4, -4, 0, 8, 4, 0, 0, 0, 1, 0],
    r: [0, -1, 0, 1, 0, 0, 0, 0, 1],
    binning_x: 2,
    binning_y: 2,
    roi: { x_offset: 2, y_offset: 2, width: 4, height: 4 },
  });
  const geometry = new THREE.BufferGeometry();
  updateDepthGeometry(
    geometry,
    { width: 2, height: 2, metres: new Float32Array([2, 2, 2, 2]) },
    cameraPlaneCorners(c, 2, 2, 'rectified', 1),
    10
  );
  expect([...geometry.getAttribute('position').array]).toEqual([-0.5, 0.5, 2, -0.5, 0, 2, 0, 0.5, 2, 0, 0, 2]);
  geometry.dispose();
});
it('bounds large frames, releases replaced buffers and reuses allocations at matching dimensions', () => {
  const geometry = new THREE.BufferGeometry(),
    dispose = vi.spyOn(geometry, 'dispose');
  const corners = [
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const depth = { width: 2048, height: 2048, metres: new Float32Array(2048 * 2048).fill(1) };
  updateDepthGeometry(geometry, depth, corners, 10);
  expect(geometry.drawRange.count).toBeGreaterThan(0);
  expect(geometry.getAttribute('position').count).toBeLessThanOrEqual(MAX_DEPTH_POINTS);
  const positions = geometry.getAttribute('position');
  updateDepthGeometry(geometry, depth, corners, 10);
  expect(geometry.getAttribute('position')).toBe(positions);
  expect(dispose).toHaveBeenCalledOnce();
  updateDepthGeometry(geometry, { width: 1, height: 1, metres: new Float32Array([NaN]) }, corners, 10);
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(geometry.drawRange.count).toBe(0);
  geometry.dispose();
});
