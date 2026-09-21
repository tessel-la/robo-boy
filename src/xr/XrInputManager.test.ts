import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XrInputManager } from './XrInputManager';

const controllers = [new THREE.Group(), new THREE.Group()];
let manager: XrInputManager;
let panel: THREE.Mesh;
let activate: ReturnType<typeof vi.fn>;
function event(index: number, type: string) {
  controllers[index].dispatchEvent({ type } as never);
}
beforeEach(() => {
  manager?.dispose();
  const scene = new THREE.Scene();
  panel = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  panel.position.z = -1;
  panel.userData.xrGrabbable = true;
  scene.add(panel);
  activate = vi.fn();
  manager = new XrInputManager({
    renderer: { xr: { getController: (index: number) => controllers[index] } } as THREE.WebGLRenderer,
    scene,
    getInteractables: () => [panel],
    onActivate: activate,
  });
  controllers.forEach((controller, index) => {
    controller.position.set(0, 0, 0);
    controller.quaternion.identity();
    controller.visible = true;
    event(index, 'connected');
  });
  manager.update();
});
describe('XR command isolation', () => {
  it('activates a stationary click', () => {
    event(0, 'selectstart');
    event(0, 'selectend');
    expect(activate).toHaveBeenCalledOnce();
  });
  it('cancels both hands selections when either hand grips, even after release', () => {
    event(0, 'selectstart');
    event(1, 'squeezestart');
    event(1, 'squeezeend');
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
  });
  it('rejects a new selection while the other hand grips', () => {
    event(1, 'squeezestart');
    event(0, 'selectstart');
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
  });
  it('does not activate after a drag returns to its starting point', () => {
    event(0, 'selectstart');
    controllers[0].position.x = 0.2;
    manager.update();
    controllers[0].position.x = 0;
    manager.update();
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
  });
  it('uses the event pose rather than the previous frame pose', () => {
    event(0, 'selectstart');
    controllers[0].position.x = 0.2;
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
  });
  it('cancels on tracking loss and ignores hidden ancestors', () => {
    event(0, 'selectstart');
    controllers[0].visible = false;
    manager.update();
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
    controllers[0].visible = true;
    panel.parent!.visible = false;
    event(0, 'selectstart');
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
  });
  it('retains wrist roll in the grab pose', () => {
    controllers[0].rotation.z = Math.PI / 2;
    const pose = manager.getPointerPose('controller-0')!;
    const direction = new THREE.Vector3(1, 0, 0).transformDirection(pose.matrixWorld);
    expect(direction.y).toBeCloseTo(1);
  });
});
