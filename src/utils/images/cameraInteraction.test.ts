import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { bindCameraPicking, focusCamera } from './cameraInteraction';
import type { Viewer } from '../ros3d';
import type { CameraImageClient } from '../ros3d/visualizers/CameraImage';
import { pinholeCorners } from './cameraCalibration';
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

it('sets an optical viewpoint from calibration, then restores an orbit view without moving the camera object', () => {
  const position = new THREE.Vector3(2, 3, 4);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.copy(position);
  const viewer = { camera, controls: { setView: vi.fn() }, setProjection: vi.fn() };
  const client = {
    object: new THREE.Group(),
    getSnapshot: () => ({
      displayed: {
        position,
        rotation,
        corners: pinholeCorners(640, 480, 500, 500, 320, 240, 1),
        frame: { image: { width: 640, height: 480 } },
      },
    }),
  };
  focusCamera(viewer as unknown as Viewer, client as unknown as CameraImageClient, true);
  const [eye, target, up] = viewer.controls.setView.mock.calls[0];
  expect(eye).toEqual(position);
  expect(target.clone().sub(position).toArray()).toEqual([0, 0, 1]);
  expect(up.x).toBeCloseTo(1);
  expect(up.y).toBeCloseTo(0);
  expect(viewer.setProjection).toHaveBeenLastCalledWith(expect.any(THREE.Matrix4), 640 / 480, client.object.uuid);
  const projection = viewer.setProjection.mock.calls[0][0] as THREE.Matrix4;
  const centre = new THREE.Vector3(0, 0, -1).applyMatrix4(projection);
  expect(centre.x).toBeCloseTo(0);
  expect(centre.y).toBeCloseTo(0);
  focusCamera(viewer as unknown as Viewer, client as unknown as CameraImageClient, false);
  const [orbitEye, orbitTarget] = viewer.controls.setView.mock.calls[1];
  expect(orbitEye.distanceTo(position)).toBeCloseTo(1.5);
  expect(orbitTarget).toEqual(position);
  expect(viewer.setProjection).toHaveBeenLastCalledWith();
  expect(position.toArray()).toEqual([2, 3, 4]);
  camera.position.set(2, 3, 10);
  focusCamera(viewer as unknown as Viewer, client as unknown as CameraImageClient, false);
  expect(viewer.controls.setView.mock.calls[2][0].toArray()).toEqual([2, 3, 5.5]);
  client.getSnapshot = () => ({}) as ReturnType<typeof client.getSnapshot>;
  focusCamera(viewer as unknown as Viewer, client as unknown as CameraImageClient, true);
  expect(viewer.controls.setView).toHaveBeenCalledTimes(3);
});

it('ignores secondary buttons, multi-touch, cancellation, hidden cameras, missed taps and zero-sized views', () => {
  const element = document.createElement('canvas');
  let size = 200;
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: size, height: size }) as DOMRect;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const object = new THREE.Group();
  const frustum = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  object.add(frustum);
  object.updateMatrixWorld(true);
  const select = vi.fn();
  const stop = bindCameraPicking(
    { camera, renderer: { domElement: element } } as unknown as Viewer,
    new Map([['info-only', { object, frustum }]]),
    select
  );
  const event = (type: string, pointerId = 1, button = 0, isPrimary = true, x = 100) => {
    const e = new MouseEvent(type, { clientX: x, clientY: 100, button });
    Object.defineProperties(e, { pointerId: { value: pointerId }, isPrimary: { value: isPrimary } });
    element.dispatchEvent(e);
  };
  const tap = () => {
    event('pointerdown');
    event('pointerup');
  };
  event('pointerdown', 1, 2);
  event('pointerup');
  event('pointerdown');
  event('pointerdown', 2, 0, false);
  event('pointerup');
  for (const cancel of ['pointercancel', 'pointerleave']) {
    event('pointerdown');
    event(cancel);
    event('pointerup');
  }
  event('pointerdown');
  event('pointerup', 2);
  event('pointerdown');
  event('pointerup', 1, 0, true, 150);
  size = 0;
  tap();
  size = 200;
  object.visible = false;
  tap();
  object.visible = true;
  frustum.visible = false;
  tap();
  frustum.visible = true;
  event('pointerdown', 1, 0, true, 0);
  event('pointerup', 1, 0, true, 0);
  expect(select).not.toHaveBeenCalled();
  tap();
  expect(select).toHaveBeenCalledWith('info-only');
  stop();
  tap();
  expect(select).toHaveBeenCalledOnce();
  frustum.geometry.dispose();
  frustum.material.dispose();
});
