import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { bindCameraPicking } from './cameraInteraction';
it('selects a camera on a tap, leaves drag gestures to orbit controls, and removes its event handlers', () => {
  const element = document.createElement('canvas');
  element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const object = new THREE.Group();
  const icon = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  object.add(icon);
  object.updateMatrixWorld(true);
  const select = vi.fn();
  const stop = bindCameraPicking(
    { camera, renderer: { domElement: element } } as any,
    new Map([['camera', { object, icon, frustum: new THREE.Group() }]]),
    select
  );
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { clientX: x, clientY: 100, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    element.dispatchEvent(event);
  };
  pointer('pointerdown', 100);
  pointer('pointermove', 140);
  pointer('pointerup', 100);
  expect(select).not.toHaveBeenCalled();
  pointer('pointerdown', 100);
  pointer('pointerup', 100);
  expect(select).toHaveBeenCalledWith('camera');
  stop();
  pointer('pointerdown', 100);
  pointer('pointerup', 100);
  expect(select).toHaveBeenCalledOnce();
});
