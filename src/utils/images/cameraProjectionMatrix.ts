import * as THREE from 'three';

/** Maps the calibrated corner rays (including inverse rectification) to WebGL clip space. */
export function cameraClipMatrix(corners: number[][], near: number, far: number) {
  const rays = corners.map(point => new THREE.Vector3(...(point as [number, number, number])));
  const z = new THREE.Vector3().crossVectors(rays[1].clone().sub(rays[0]), rays[3].clone().sub(rays[0])).normalize();
  const distance = rays[0].dot(z);
  if (!Number.isFinite(distance) || distance <= 0 || near <= 0 || far <= near)
    throw new Error('Invalid projection rays.');
  rays.forEach(ray => ray.divideScalar(distance));
  const basis = new THREE.Matrix4().makeBasis(rays[1].clone().sub(rays[0]), rays[3].clone().sub(rays[0]), rays[0]);
  if (Math.abs(basis.determinant()) < 1e-12) throw new Error('Degenerate camera rays.');
  return new THREE.Matrix4()
    .set(2, 0, -1, 0, 0, -2, 1, 0, 0, 0, (far + near) / (far - near), (-2 * far * near) / (far - near), 0, 0, 1, 0)
    .multiply(basis.invert());
}
