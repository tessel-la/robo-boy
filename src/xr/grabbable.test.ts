import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  XrGrabController,
  applyXrPose,
  defaultPanelPose,
  toXrPose,
  type GrabPointerPose,
} from './grabbable';

const pointerAt = (id: string, x: number, y: number, z: number): GrabPointerPose => {
  const origin = new THREE.Vector3(x, y, z);
  const matrixWorld = new THREE.Matrix4().compose(
    origin,
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1)
  );
  return { id, matrixWorld, origin };
};

describe('pose round trip', () => {
  it('survives being written and read back', () => {
    const object = new THREE.Object3D();
    const pose = {
      position: [0.5, 1.4, -1.2] as [number, number, number],
      quaternion: [0, 0.7071, 0, 0.7071] as [number, number, number, number],
      scale: 1.5,
    };

    applyXrPose(object, pose);
    const read = toXrPose(object);

    expect(read.position).toEqual(pose.position);
    expect(read.scale).toBeCloseTo(1.5);
    read.quaternion.forEach((value, index) => expect(value).toBeCloseTo(pose.quaternion[index], 4));
  });

  it('normalizes a rotation that arrived slightly off unit length', () => {
    const object = new THREE.Object3D();
    applyXrPose(object, { position: [0, 0, 0], quaternion: [0, 0, 0, 2], scale: 1 });
    expect(object.quaternion.length()).toBeCloseTo(1);
  });
});

describe('default placement', () => {
  it('puts a single panel straight ahead at eye height', () => {
    const pose = defaultPanelPose(0, 1);
    expect(pose.position[0]).toBeCloseTo(0);
    expect(pose.position[1]).toBeGreaterThan(1);
    // Negative Z is forward in a WebXR reference space.
    expect(pose.position[2]).toBeLessThan(0);
  });

  it('spreads several panels across an arc without stacking them', () => {
    const poses = [0, 1, 2].map(index => defaultPanelPose(index, 3));
    const xs = poses.map(pose => pose.position[0]);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    // Every panel stays at roughly arm's length rather than drifting away along the arc.
    for (const pose of poses) {
      const radius = Math.hypot(pose.position[0], pose.position[2]);
      expect(radius).toBeCloseTo(1.6, 1);
    }
  });
});

describe('single-handed grab', () => {
  it('carries the object rigidly with the hand', () => {
    const object = new THREE.Object3D();
    object.position.set(0, 1, -1);
    const controller = new XrGrabController();

    controller.begin(object, pointerAt('a', 0, 1, 0), true);
    controller.update(new Map([['a', pointerAt('a', 0.5, 1, 0)]]));

    // The object keeps its offset from the hand, so it moves by exactly what the hand moved.
    expect(object.position.x).toBeCloseTo(0.5);
    expect(object.position.y).toBeCloseTo(1);
    expect(object.position.z).toBeCloseTo(-1);
  });

  it('leaves the object alone when its pointer stops reporting', () => {
    const object = new THREE.Object3D();
    object.position.set(0, 1, -1);
    const controller = new XrGrabController();

    controller.begin(object, pointerAt('a', 0, 1, 0), true);
    // A controller losing tracking mid-grab must not snap the object to a stale pose.
    controller.update(new Map());
    expect(object.position.toArray()).toEqual([0, 1, -1]);
  });

  it('releases only the pointer that let go', () => {
    const object = new THREE.Object3D();
    const controller = new XrGrabController();

    controller.begin(object, pointerAt('a', 0, 1, 0), true);
    expect(controller.isGrabbed(object)).toBe(true);
    controller.release(object, 'b');
    expect(controller.isGrabbed(object)).toBe(true);
    controller.release(object, 'a');
    expect(controller.isGrabbed(object)).toBe(false);
  });
});

describe('two-handed scale', () => {
  it('scales by the ratio of the distance between the hands', () => {
    const object = new THREE.Object3D();
    const controller = new XrGrabController();

    controller.begin(object, pointerAt('a', -0.2, 1, -1), true);
    controller.begin(object, pointerAt('b', 0.2, 1, -1), true);

    // The first frame with both hands present seeds the gesture rather than applying it, because
    // the second hand's pose is only known here.
    controller.update(
      new Map([
        ['a', pointerAt('a', -0.2, 1, -1)],
        ['b', pointerAt('b', 0.2, 1, -1)],
      ])
    );
    expect(object.scale.x).toBeCloseTo(1);

    // Hands twice as far apart: twice the size.
    controller.update(
      new Map([
        ['a', pointerAt('a', -0.4, 1, -1)],
        ['b', pointerAt('b', 0.4, 1, -1)],
      ])
    );
    expect(object.scale.x).toBeCloseTo(2);
    // Uniform, always — a non-uniformly scaled panel distorts its text.
    expect(object.scale.y).toBeCloseTo(object.scale.x);
    expect(object.scale.z).toBeCloseTo(object.scale.x);
  });

  it('clamps scale so a slip cannot lose the object entirely', () => {
    const object = new THREE.Object3D();
    const controller = new XrGrabController();

    controller.begin(object, pointerAt('a', -0.001, 1, -1), true);
    controller.begin(object, pointerAt('b', 0.001, 1, -1), true);
    controller.update(
      new Map([
        ['a', pointerAt('a', -0.001, 1, -1)],
        ['b', pointerAt('b', 0.001, 1, -1)],
      ])
    );
    controller.update(
      new Map([
        ['a', pointerAt('a', -50, 1, -1)],
        ['b', pointerAt('b', 50, 1, -1)],
      ])
    );

    expect(object.scale.x).toBeLessThanOrEqual(20);
  });

  it('does not upgrade to two hands when the object forbids scaling', () => {
    const object = new THREE.Object3D();
    const controller = new XrGrabController();

    controller.begin(object, pointerAt('a', -0.2, 1, -1), false);
    controller.begin(object, pointerAt('b', 0.2, 1, -1), false);

    controller.update(
      new Map([
        ['a', pointerAt('a', -0.4, 1, -1)],
        ['b', pointerAt('b', 0.4, 1, -1)],
      ])
    );
    expect(object.scale.x).toBeCloseTo(1);
  });
});
