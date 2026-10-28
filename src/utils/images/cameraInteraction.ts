import * as THREE from 'three';
import type { Viewer } from '../ros3d';
import type { CameraImageClient } from '../ros3d/visualizers/CameraImage';
import { cameraClipMatrix } from './cameraProjectionMatrix';

export function focusCamera(viewer: Viewer, client: CameraImageClient, through: boolean) {
  const snapshot = client.getSnapshot().displayed;
  if (!snapshot) return;
  if (through) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(snapshot.rotation);
    const up = new THREE.Vector3(0, -1, 0).applyQuaternion(snapshot.rotation);
    viewer.controls?.setView(snapshot.position, snapshot.position.clone().add(forward), up);
    const projection = cameraClipMatrix(snapshot.corners, 0.01, viewer.camera.far).multiply(
      new THREE.Matrix4().makeRotationX(Math.PI)
    );
    viewer.setProjection(projection, snapshot.frame.image.width / snapshot.frame.image.height, client.object.uuid);
  } else {
    const offset = viewer.camera.position.clone().sub(snapshot.position);
    if (offset.lengthSq() < 0.01) offset.set(1, 1, 1);
    offset.normalize().multiplyScalar(1.5);
    viewer.setProjection();
    viewer.controls?.setView(snapshot.position.clone().add(offset), snapshot.position);
  }
}

/** A tap selects; orbit/pan gestures and multi-touch never become camera clicks. */
export type CameraPickObject = { object: THREE.Object3D; frustum: THREE.Object3D; icon?: THREE.Object3D };
export function bindCameraPicking(
  viewer: Viewer,
  clients: ReadonlyMap<string, CameraPickObject>,
  select: (id: string) => void
) {
  const element = viewer.renderer.domElement;
  let start: { id: number; x: number; y: number; moved: boolean } | undefined;
  const raycaster = new THREE.Raycaster();
  const down = (event: PointerEvent) => {
    if (start || event.button !== 0 || !event.isPrimary) {
      start = undefined;
      return;
    }
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const move = (event: PointerEvent) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) start.moved = true;
  };
  const cancel = () => {
    start = undefined;
  };
  const up = (event: PointerEvent) => {
    const press = start;
    start = undefined;
    if (
      !press ||
      press.id !== event.pointerId ||
      press.moved ||
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5
    )
      return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2
      ),
      viewer.camera
    );
    raycaster.params.Line = { threshold: 0.025 };
    const owners = new Map<THREE.Object3D, string>();
    for (const [id, client] of clients)
      if (client.object.visible) {
        if (client.icon) owners.set(client.icon, id);
        if (client.frustum.visible) owners.set(client.frustum, id);
      }
    const hit = raycaster.intersectObjects([...owners.keys()], false)[0];
    const id = hit && owners.get(hit.object);
    if (id) select(id);
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('pointerleave', cancel);
  return () => {
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('pointerleave', cancel);
  };
}
