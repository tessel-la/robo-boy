import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from './ros3d';

type TestControls = { target: THREE.Vector3 };

const dispatchTouch = (
  element: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend',
  points: Array<{ clientX: number; clientY: number }>
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: points });
  element.dispatchEvent(event);
  return event;
};

describe('active ROS3D OrbitControls interactions', () => {
  let element: HTMLDivElement;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;

  beforeEach(() => {
    element = document.createElement('div');
    Object.defineProperties(element, {
      clientWidth: { value: 500 },
      clientHeight: { value: 400 },
    });
    document.body.appendChild(element);

    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(3, 3, 3);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    controls = new OrbitControls({
      scene: new THREE.Scene(),
      camera,
      element,
      userPanSpeed: 1,
    });
  });

  afterEach(() => {
    controls.dispose();
    element.remove();
  });

  it('pans with Ctrl + left drag', () => {
    const target = (controls as unknown as TestControls).target;

    element.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 130,
        clientY: 115,
        bubbles: true,
        cancelable: true,
      })
    );
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(target.length()).toBeGreaterThan(0);
  });

  it('pans with a middle-button drag', () => {
    const target = (controls as unknown as TestControls).target;

    element.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 1,
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 130,
        clientY: 115,
        bubbles: true,
        cancelable: true,
      })
    );
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(target.length()).toBeGreaterThan(0);
  });

  it('pans with two fingers without changing zoom when their spacing is stable', () => {
    const target = (controls as unknown as TestControls).target;
    const initialDistance = camera.position.distanceTo(target);

    dispatchTouch(element, 'touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]);
    dispatchTouch(element, 'touchmove', [
      { clientX: 104, clientY: 103 },
      { clientX: 204, clientY: 103 },
    ]);
    dispatchTouch(element, 'touchmove', [
      { clientX: 108, clientY: 106 },
      { clientX: 208, clientY: 106 },
    ]);
    dispatchTouch(element, 'touchend', []);

    expect(target.length()).toBeGreaterThan(0);
    expect(camera.position.distanceTo(target)).toBeCloseTo(initialDistance, 10);
  });
});
