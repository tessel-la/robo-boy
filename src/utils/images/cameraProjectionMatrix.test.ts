import * as THREE from 'three';
import { expect, it } from 'vitest';
import { cameraClipMatrix } from './cameraProjectionMatrix';
import { cameraPlaneCorners, parseCameraInfo } from './cameraCalibration';
const calibration = parseCameraInfo({
  header: { frame_id: 'camera' },
  width: 640,
  height: 480,
  k: [300, 0, 270, 0, 350, 210, 0, 0, 1],
});
it('projects asymmetric calibrated rays to the correct corners independently of plane distance', () => {
  for (const distance of [0.1, 1, 7]) {
    const corners = cameraPlaneCorners(calibration, 640, 480, 'raw', distance);
    const matrix = cameraClipMatrix(corners, 0.01, 20);
    for (const [index, xy] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].entries()) {
      const p = new THREE.Vector3(...(corners[index] as [number, number, number])).applyMatrix4(matrix);
      expect(p.x).toBeCloseTo(xy[0]);
      expect(p.y).toBeCloseTo(xy[1]);
      expect(p.z).toBeGreaterThan(-1);
      expect(p.z).toBeLessThan(1);
    }
    expect(new THREE.Vector4(0, 0, -1, 1).applyMatrix4(matrix).w).toBeLessThan(0);
  }
});
it('honors rectification rotations rather than assuming symmetric pinhole rays', () => {
  const angle = 0.2,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const rectified = {
    ...calibration,
    r: [c, 0, s, 0, 1, 0, -s, 0, c],
    p: [300, 0, 270, -50, 0, 350, 210, 0, 0, 0, 1, 0],
  };
  const corners = cameraPlaneCorners(rectified, 640, 480, 'rectified', 1);
  const matrix = cameraClipMatrix(corners, 0.01, 20);
  expect(
    new THREE.Vector3(...(corners[0] as [number, number, number])).applyMatrix4(matrix).toArray().slice(0, 2)
  ).toEqual(expect.arrayContaining([expect.closeTo(-1), expect.closeTo(1)]));
});
