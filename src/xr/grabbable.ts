import * as THREE from 'three';
import type { XrPose } from './types';

/** Bounds on how far a grabbed object may be scaled, so a slip cannot lose it entirely. */
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

interface SingleGrab {
  kind: 'single';
  pointerId: string;
  /** Object pose expressed in the pointer's frame at the moment of the grab. */
  offset: THREE.Matrix4;
}

interface DualGrab {
  kind: 'dual';
  pointerIds: [string, string];
  startDistance: number;
  startScale: number;
  startMidpoint: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startDirection: THREE.Vector3;
}

type GrabState = SingleGrab | DualGrab;

export interface GrabPointerPose {
  id: string;
  /** World matrix of the hand or controller. */
  matrixWorld: THREE.Matrix4;
  origin: THREE.Vector3;
}

const scratchMatrix = new THREE.Matrix4();
const scratchParentInverse = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

/**
 * Moves, rotates and scales grabbed objects from pointer poses.
 *
 * One hand is a rigid 6-DoF carry: the object keeps its pose relative to the hand, so it rotates as
 * the wrist does rather than needing a separate rotate gesture. Two hands on the same object scale
 * it by the ratio of the distance between them and yaw it by the direction between them — the
 * gesture people already expect from handling a map.
 *
 * Scale is uniform on purpose. A non-uniformly scaled panel distorts its rasterised text, and a
 * non-uniformly scaled robot is simply wrong.
 */
export class XrGrabController {
  private readonly grabs = new Map<THREE.Object3D, GrabState>();

  /** Whether anything is currently held. */
  get isGrabbing(): boolean {
    return this.grabs.size > 0;
  }

  isGrabbed(object: THREE.Object3D): boolean {
    return this.grabs.has(object);
  }

  /**
   * Start or extend a grab on an object.
   *
   * A second pointer grabbing an already-held object upgrades it to a two-handed gesture rather than
   * stealing it, which is what makes scaling reachable without a mode switch.
   */
  begin(object: THREE.Object3D, pointer: GrabPointerPose, allowScale: boolean): void {
    const existing = this.grabs.get(object);

    if (existing && existing.kind === 'single' && allowScale && existing.pointerId !== pointer.id) {
      this.grabs.set(object, this.createDualGrab(object, existing.pointerId, pointer));
      return;
    }
    if (existing) return;

    object.updateWorldMatrix(true, false);
    scratchMatrix.copy(pointer.matrixWorld).invert().multiply(object.matrixWorld);
    this.grabs.set(object, {
      kind: 'single',
      pointerId: pointer.id,
      offset: scratchMatrix.clone(),
    });
  }

  private createDualGrab(
    object: THREE.Object3D,
    firstPointerId: string,
    second: GrabPointerPose
  ): DualGrab {
    // Origins are filled in on the next update; the placeholder keeps the shape valid until then.
    return {
      kind: 'dual',
      pointerIds: [firstPointerId, second.id],
      startDistance: 0,
      startScale: object.scale.x,
      startMidpoint: new THREE.Vector3(),
      startPosition: object.position.clone(),
      startQuaternion: object.quaternion.clone(),
      startDirection: new THREE.Vector3(1, 0, 0),
    };
  }

  /** Release one pointer. A two-handed grab degrades to one hand rather than dropping the object. */
  release(object: THREE.Object3D, pointerId: string, remainingPose?: GrabPointerPose): void {
    const grab = this.grabs.get(object);
    if (!grab) return;

    if (grab.kind === 'single') {
      if (grab.pointerId === pointerId) this.grabs.delete(object);
      return;
    }

    if (!grab.pointerIds.includes(pointerId)) return;
    this.grabs.delete(object);
    if (remainingPose && grab.pointerIds.includes(remainingPose.id) && remainingPose.id !== pointerId) {
      this.begin(object, remainingPose, true);
    }
  }

  releaseAll(): void {
    this.grabs.clear();
  }

  /**
   * Apply one frame of movement.
   *
   * `poses` is every pointer that currently holds something, keyed by id. Objects whose pointers
   * have gone — a controller losing tracking mid-grab — are left where they are rather than snapped
   * to a stale pose.
   */
  update(poses: ReadonlyMap<string, GrabPointerPose>): void {
    for (const [object, grab] of this.grabs) {
      if (grab.kind === 'single') {
        const pose = poses.get(grab.pointerId);
        if (!pose) continue;
        this.applySingle(object, grab, pose);
      } else {
        const first = poses.get(grab.pointerIds[0]);
        const second = poses.get(grab.pointerIds[1]);
        if (!first || !second) continue;
        this.applyDual(object, grab, first, second);
      }
    }
  }

  private applySingle(object: THREE.Object3D, grab: SingleGrab, pose: GrabPointerPose): void {
    scratchMatrix.copy(pose.matrixWorld).multiply(grab.offset);
    this.applyWorldMatrix(object, scratchMatrix);
  }

  private applyDual(
    object: THREE.Object3D,
    grab: DualGrab,
    first: GrabPointerPose,
    second: GrabPointerPose
  ): void {
    const distance = first.origin.distanceTo(second.origin);
    const midpoint = scratchPosition.copy(first.origin).add(second.origin).multiplyScalar(0.5);
    const direction = new THREE.Vector3().subVectors(second.origin, first.origin).normalize();

    // Seed on the first frame with both hands present, rather than at begin(), because the second
    // hand's pose is only known here.
    if (distance < 1e-4) return;
    if (grab.startDistance === 0) {
      grab.startDistance = Math.max(distance, 1e-4);
      grab.startMidpoint.copy(midpoint);
      grab.startDirection.copy(direction);
      grab.startPosition.copy(object.position);
      grab.startQuaternion.copy(object.quaternion);
      grab.startScale = object.scale.x;
      return;
    }

    const scale = THREE.MathUtils.clamp(grab.startScale * distance / grab.startDistance, MIN_SCALE, MAX_SCALE);
    const ratio = scale / grab.startScale;

    // Rotation is the shortest arc between the two inter-hand directions, which gives a natural
    // twist without picking an arbitrary axis.
    const twist = new THREE.Quaternion().setFromUnitVectors(grab.startDirection, direction);
    if (object.parent) {
      const parentRotation = object.parent.getWorldQuaternion(new THREE.Quaternion());
      twist.premultiply(parentRotation.clone().invert()).multiply(parentRotation);
    }

    object.scale.setScalar(scale);
    object.quaternion.copy(twist).multiply(grab.startQuaternion);

    // Scale about the midpoint so the object grows under the hands rather than away from them.
    const parent = object.parent;
    const localMidStart = grab.startMidpoint.clone();
    const localMidNow = midpoint.clone();
    if (parent) {
      parent.updateMatrixWorld();
      scratchParentInverse.copy(parent.matrixWorld).invert();
      localMidStart.applyMatrix4(scratchParentInverse);
      localMidNow.applyMatrix4(scratchParentInverse);
    }
    const offset = grab.startPosition.clone().sub(localMidStart);
    offset.applyQuaternion(twist).multiplyScalar(ratio);
    object.position.copy(localMidNow).add(offset);
  }

  /** Write a world matrix onto an object that may be parented below other transforms. */
  private applyWorldMatrix(object: THREE.Object3D, worldMatrix: THREE.Matrix4): void {
    const parent = object.parent;
    if (parent) {
      parent.updateMatrixWorld();
      scratchParentInverse.copy(parent.matrixWorld).invert();
      scratchMatrix.copy(worldMatrix).premultiply(scratchParentInverse);
    } else {
      scratchMatrix.copy(worldMatrix);
    }
    scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
    object.position.copy(scratchPosition);
    object.quaternion.copy(scratchQuaternion);
    // Scale is owned by the two-hand gesture; a rigid carry must not drift it through matrix
    // round-tripping.
    object.updateWorldMatrix(true, false);
  }
}

/** Read an object's transform into the serializable shape used by XR workspace storage. */
export const toXrPose = (object: THREE.Object3D): XrPose => ({
  position: [object.position.x, object.position.y, object.position.z],
  quaternion: [
    object.quaternion.x,
    object.quaternion.y,
    object.quaternion.z,
    object.quaternion.w,
  ],
  scale: object.scale.x,
});

/** Apply a stored placement to an object. */
export const applyXrPose = (object: THREE.Object3D, pose: XrPose): void => {
  object.position.set(pose.position[0], pose.position[1], pose.position[2]);
  object.quaternion.set(
    pose.quaternion[0],
    pose.quaternion[1],
    pose.quaternion[2],
    pose.quaternion[3]
  );
  object.quaternion.normalize();
  object.scale.setScalar(pose.scale);
  object.updateWorldMatrix(true, false);
};

/**
 * Default placement for a panel that has never been positioned.
 *
 * Panels are laid out on an arc at eye height so several are reachable without walking, and the
 * first one lands directly ahead rather than off to one side.
 */
export const defaultPanelPose = (index: number, total: number): XrPose => {
  const radius = 1.6;
  const spread = Math.min(Math.PI * 0.75, 0.5 * Math.max(total - 1, 0));
  const angle = total <= 1 ? 0 : -spread / 2 + (spread * index) / (total - 1);
  const position: [number, number, number] = [
    Math.sin(angle) * radius,
    1.4,
    -Math.cos(angle) * radius,
  ];
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0));
  return {
    position,
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: 1,
  };
};
