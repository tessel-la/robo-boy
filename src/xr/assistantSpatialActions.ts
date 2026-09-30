import * as THREE from 'three';
import type { SpatialWorkspaceSnapshot } from '../features/assistant/types';
import type { SpatialWorkspaceOperation, WorkspaceEditResult } from '../features/assistant/tools/workspaceTool';

export interface SpatialPanel {
  id: string;
  title: string;
  object: THREE.Object3D;
}
const viewerBasis = (camera: THREE.Camera) => {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const forward = camera.getWorldDirection(new THREE.Vector3());
  forward.y = 0;
  if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  return { origin, forward, right };
};
export function spatialWorkspaceSnapshot(
  camera: THREE.Camera,
  panels: readonly SpatialPanel[]
): SpatialWorkspaceSnapshot {
  const { origin, forward, right } = viewerBasis(camera);
  return {
    panels: panels.slice(0, 40).map(panel => {
      const offset = panel.object.getWorldPosition(new THREE.Vector3()).sub(origin);
      return {
        id: panel.id,
        right: +offset.dot(right).toFixed(2),
        up: +offset.y.toFixed(2),
        forward: +offset.dot(forward).toFixed(2),
        scale: +panel.object.scale.x.toFixed(2),
      };
    }),
  };
}
/** Semantic viewer-relative placement. The caller cancels holds before applying and persists each result. */
export function applySpatialWorkspaceOperation(
  operation: SpatialWorkspaceOperation,
  camera: THREE.Camera,
  panels: readonly SpatialPanel[],
  cancel: () => void,
  persist: (object: THREE.Object3D) => void
): WorkspaceEditResult {
  const { origin, forward, right } = viewerBasis(camera);
  const place = (panel: SpatialPanel, world: THREE.Vector3) => {
    panel.object.position.copy(panel.object.parent ? panel.object.parent.worldToLocal(world.clone()) : world);
    // Face the viewer in world space, correcting for the room's rotation.
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(origin.x - world.x, origin.z - world.z)
    );
    if (panel.object.parent)
      rotation.premultiply(panel.object.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    panel.object.quaternion.copy(rotation);
    panel.object.updateWorldMatrix(true, true);
    persist(panel.object);
  };
  if (operation.op === 'movePanel') {
    const panel = panels.find(panel => panel.id === operation.panelId);
    if (!panel) return { operation, ok: false, message: 'That panel is not mounted in XR yet. Retry once it is open.' };
    const position = panel.object.getWorldPosition(new THREE.Vector3());
    switch (operation.direction) {
      case 'front':
        position.copy(origin).addScaledVector(forward, 1.4);
        position.y -= 0.15;
        break;
      case 'left':
        position.addScaledVector(right, -0.45);
        break;
      case 'right':
        position.addScaledVector(right, 0.45);
        break;
      case 'up':
        position.y += 0.35;
        break;
      case 'down':
        position.y -= 0.35;
        break;
      case 'closer':
        position.addScaledVector(position.clone().sub(origin).normalize(), -0.4);
        break;
      case 'farther':
        position.addScaledVector(position.clone().sub(origin).normalize(), 0.4);
        break;
      default:
        return { operation, ok: false, message: 'Unknown spatial direction.' };
    }
    const offset = position.clone().sub(origin);
    if (offset.length() < 0.65 || offset.length() > 8 || offset.dot(forward) < 0.35) {
      return {
        operation,
        ok: false,
        message: 'That move would place the panel too close, out of reach, or behind you. Ask to bring it in front.',
      };
    }
    cancel();
    place(panel, position);
    return { operation, ok: true, message: `Moved ${panel.title} ${operation.direction}.` };
  }
  if (!panels.length) return { operation, ok: false, message: 'No XR panels are open to arrange.' };
  if (panels.length > 20) return { operation, ok: false, message: 'Close some panels before arranging (maximum 20).' };
  if (!['arc', 'grid'].includes(operation.layout))
    return { operation, ok: false, message: 'Unknown spatial arrangement.' };
  const spacing = Math.max(1.1, ...panels.map(panel => panel.object.scale.x * 1.1));
  cancel();
  panels.forEach((panel, index) => {
    let position: THREE.Vector3;
    if (operation.layout === 'grid') {
      const columns = Math.min(3, panels.length);
      const rows = Math.ceil(panels.length / columns);
      position = origin
        .clone()
        .addScaledVector(forward, Math.max(1.8, spacing * 1.6))
        .addScaledVector(right, ((index % columns) - (columns - 1) / 2) * spacing);
      position.y += ((rows - 1) / 2 - Math.floor(index / columns)) * spacing * 0.85 - 0.15;
    } else {
      const span = Math.min(Math.PI * 0.8, Math.max(0, panels.length - 1) * 0.6);
      const radius = Math.max(1.6, (panels.length * spacing) / Math.max(1, span));
      const angle = panels.length === 1 ? 0 : (index / (panels.length - 1) - 0.5) * span;
      position = origin
        .clone()
        .addScaledVector(forward, Math.cos(angle) * radius)
        .addScaledVector(right, Math.sin(angle) * radius);
      position.y -= 0.15;
    }
    place(panel, position);
  });
  return {
    operation,
    ok: true,
    message: `Arranged ${panels.length} panels in ${operation.layout === 'arc' ? 'an arc' : 'a grid'}.`,
  };
}
