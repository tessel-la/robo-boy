import * as THREE from 'three';

export const VIEW_SCALE_LIMITS = { min: 0.02, max: 8 } as const;

export interface ViewFit {
  scale: number;
  position: [number, number, number];
  /** Unscaled height of the content's lowest point above the origin; keeps it standing on the floor. */
  restY: number;
}

const scratchBox = new THREE.Box3();
const scratchMatrix = new THREE.Matrix4();

/**
 * Bounds of the solid geometry under `root`, expressed in `space`'s frame.
 *
 * Only visible meshes count. Points, lines and sprites are left out on purpose: a lidar cloud or a
 * frame label can be tens of metres across, and fitting to it would shrink the robot to a speck.
 */
export const computeMeshBounds = (root: THREE.Object3D, space: THREE.Object3D): THREE.Box3 | null => {
  space.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, true);
  const inverse = scratchMatrix.copy(space.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const local = new THREE.Matrix4();

  root.traverseVisible(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    local.multiplyMatrices(inverse, mesh.matrixWorld);
    bounds.union(scratchBox.copy(box).applyMatrix4(local));
  });

  const size = bounds.getSize(new THREE.Vector3());
  const finite = [size.x, size.y, size.z].every(Number.isFinite);
  return !bounds.isEmpty() && finite ? bounds : null;
};

/**
 * Scale and offset that stand `bounds` centred on a circular stage and inside its height.
 *
 * `bounds` is in the content's own Y-up frame. The footprint is treated as its bounding circle so
 * the result stays valid however the content is yawed afterwards.
 */
export const fitBoundsToStage = (
  bounds: THREE.Box3,
  stage: { radius: number; height: number },
  margin = 0.85
): ViewFit => {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const footprint = Math.max(Math.hypot(size.x, size.z) / 2, 1e-6);
  const height = Math.max(size.y, 1e-6);
  const scale = THREE.MathUtils.clamp(
    Math.min((stage.radius * margin) / footprint, (stage.height * margin) / height),
    VIEW_SCALE_LIMITS.min,
    VIEW_SCALE_LIMITS.max
  );
  return {
    scale,
    position: [-center.x * scale, -bounds.min.y * scale, -center.z * scale],
    restY: -bounds.min.y,
  };
};
