import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XrInputManager, type XrInputManagerOptions } from './XrInputManager';

const controllers = [new THREE.Group(), new THREE.Group()];
const grips = [new THREE.Group(), new THREE.Group()];
let manager: XrInputManager;
let panel: THREE.Mesh;
let activate: ReturnType<typeof vi.fn<NonNullable<XrInputManagerOptions['onActivate']>>>;
function event(index: number, type: string, data?: unknown) {
  controllers[index].dispatchEvent({ type, data } as never);
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
    renderer: {
      xr: {
        getController: (index: number) => controllers[index],
        getControllerGrip: (index: number) => grips[index],
      },
    } as unknown as THREE.WebGLRenderer,
    scene,
    getInteractables: () => [panel],
    onActivate: activate,
  });
  controllers.forEach((controller, index) => {
    controller.position.set(0, 0, 0);
    controller.quaternion.identity();
    controller.visible = true;
    grips[index].visible = false;
    grips[index].position.set(0, 0, 0);
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

describe('XR picking and wrist pose', () => {
  it('skips subtrees marked not pickable', () => {
    const heavy = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    inner.position.z = -0.5;
    heavy.userData.xrPickable = false;
    heavy.add(inner);
    panel.add(heavy);
    panel.position.z = -2;
    heavy.position.z = 1.5;
    event(0, 'selectstart');
    event(0, 'selectend');
    // The ray passes through the unpickable mesh and lands on the panel behind it.
    expect(activate).toHaveBeenCalledOnce();
    expect(activate.mock.calls[0][1].object).toBe(panel);
  });

  it('keeps a hand from pointing at UI excluded for its handedness', () => {
    event(0, 'connected', { handedness: 'left' });
    panel.userData.xrExcludeHandedness = 'left';
    event(0, 'selectstart');
    event(0, 'selectend');
    expect(activate).not.toHaveBeenCalled();
    event(1, 'connected', { handedness: 'right' });
    event(1, 'selectstart');
    event(1, 'selectend');
    expect(activate).toHaveBeenCalledOnce();
  });

  it('reports the grip pose for a connected hand, falling back to the ray space', () => {
    expect(manager.getWristPose('left')).toBeNull();
    event(0, 'connected', { handedness: 'left' });
    controllers[0].position.set(1, 2, 3);
    expect(manager.getWristPose('left')?.matrix.elements.slice(12, 15)).toEqual([1, 2, 3]);
    grips[0].visible = true;
    grips[0].position.set(4, 5, 6);
    expect(manager.getWristPose('left')?.matrix.elements.slice(12, 15)).toEqual([4, 5, 6]);
    grips[0].visible = false;
    controllers[0].visible = false;
    expect(manager.getWristPose('left')).toBeNull();
  });
  it('forwards a grab from a hit proxy to the object it stands for', () => {
    const scene = new THREE.Scene();
    const target = new THREE.Group();
    target.userData.xrGrabbable = true;
    const proxy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    proxy.position.z = -1;
    proxy.userData.xrGrabTarget = target;
    scene.add(target, proxy);
    const onGrabStart = vi.fn();
    const local = new XrInputManager({
      renderer: {
        xr: {
          getController: (index: number) => controllers[index],
          getControllerGrip: (index: number) => grips[index],
        },
      } as unknown as THREE.WebGLRenderer,
      scene,
      getInteractables: () => [proxy],
      onGrabStart,
    });
    event(0, 'connected');
    local.update();
    event(0, 'squeezestart');
    expect(onGrabStart).toHaveBeenCalledOnce();
    expect(onGrabStart.mock.calls[0][1].object).toBe(target);
    event(0, 'squeezeend');
    local.dispose();
  });
});
