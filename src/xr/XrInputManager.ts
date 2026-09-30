import * as THREE from 'three';
import type { XrInteractionMode, XrPointer, XrPointerSource } from './types';
import { isXrGrabbable } from './types';
import type { GrabPointerPose } from './grabbable';

/** Distance the pointer ray is drawn and tested to, in metres. */
const RAY_LENGTH = 8;

export interface XrInputTarget {
  /** The object a ray resolved to. */
  object: THREE.Object3D;
  /** World-space point where the ray met it. */
  point: THREE.Vector3;
  distance: number;
  /**
   * Texture coordinate of the hit, when the geometry has one.
   *
   * Carried through because a rasterised DOM panel needs it: three's HTMLMesh expects pointer
   * events whose payload is the normalized surface coordinate, which it converts back into an
   * element-space position to replay onto the real DOM.
   */
  uv: THREE.Vector2 | null;
}

/** Pose of a hand's wrist-mounted anchor, in world space. */
export interface XrWristPose {
  matrix: THREE.Matrix4;
  /** False when the pose is a stale fallback rather than a live tracked one. */
  tracked: boolean;
}

export interface XrInputManagerOptions {
  renderer: THREE.WebGLRenderer;
  /** Controller and hand objects are parented here. */
  scene: THREE.Object3D;
  /** Objects a ray may hit. Re-read every frame so panels can come and go. */
  getInteractables: () => readonly THREE.Object3D[];
  /**
   * A completed activation: select began and ended on the same target without becoming a drag.
   * Hold controls opt into the balanced onPressStart/onPressEnd lifecycle below.
   */
  onActivate?: (pointer: XrPointer, target: XrInputTarget) => void;
  onPressStart?: (pointer: XrPointer, target: XrInputTarget) => void;
  onPressEnd?: (pointer: XrPointer, cancelled: boolean) => void;
  onPressMove?: (pointer: XrPointer, target: XrInputTarget) => void;
  onHoverChange?: (pointer: XrPointer, target: XrInputTarget | null) => void;
  onGrabStart?: (pointer: XrPointer, target: XrInputTarget) => void;
  onGrabEnd?: (pointer: XrPointer, object: THREE.Object3D) => void;
  /** Explicit workspace-menu toggle from the left controller's primary face button (X). */
  onMenuToggle?: () => void;
  /** Identity of the actual control within a surface, not just its shared mesh. */
  getActivationTarget?: (target: XrInputTarget) => unknown;
  /** Continuous controls may move within the SAME control, never onto another target. */
  allowsPressDrag?: (target: XrInputTarget) => boolean;
}

interface PointerState {
  id: string;
  source: XrPointerSource;
  handedness: XRHandedness;
  object: THREE.Object3D | null;
  ray: THREE.Ray;
  selecting: boolean;
  connected: boolean;
  activationTarget: unknown;
  pressDragging: boolean;
  squeezing: boolean;
  hovered: THREE.Object3D | null;
  /** What select began on, so an activation can require it to end on the same thing. */
  selectOrigin: THREE.Object3D | null;
  /** Where select began, so a drag can be told from a press. */
  selectOriginPoint: THREE.Vector3 | null;
  grabbed: THREE.Object3D | null;
  rayLine: THREE.Line | null;
  grip: THREE.Object3D;
  inputSource: XRInputSource | null;
  menuButtonPressed: boolean;
}

/** Beyond this much travel, a select is a drag and must not activate anything. */
const ACTIVATION_SLOP_METRES = 0.05;

const hasHiddenAncestor = (object: THREE.Object3D): boolean => {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (!parent.visible) return true;
  }
  return false;
};

/**
 * Gather the meshes a ray may hit under one root.
 *
 * Done by hand rather than with `intersectObjects(roots, true)` because that tests every triangle of
 * everything below, including a 200k-point cloud or a full URDF mesh set that nothing is meant to
 * grab. Subtrees marked `userData.xrPickable === false` are skipped whole, so a heavy visualization
 * costs nothing per ray, and `xrExcludeHandedness` keeps a hand from pointing at UI mounted on
 * itself.
 */
const collectPickable = (object: THREE.Object3D, handedness: XRHandedness, out: THREE.Mesh[]): void => {
  if (!object.visible) return;
  const data = object.userData as { xrPickable?: boolean; xrExcludeHandedness?: XRHandedness };
  if (data.xrPickable === false) return;
  if (data.xrExcludeHandedness && data.xrExcludeHandedness === handedness) return;
  if ((object as THREE.Mesh).isMesh) out.push(object as THREE.Mesh);
  for (const child of object.children) collectPickable(child, handedness, out);
};

/** The input-source lifecycle events three does not include in XRTargetRaySpace's event map. */
type XrSourceEvent = { data?: XRInputSource };
interface XrSourceEventTarget {
  addEventListener(type: 'connected' | 'disconnected', listener: (event: XrSourceEvent) => void): void;
  removeEventListener(type: 'connected' | 'disconnected', listener: (event: XrSourceEvent) => void): void;
}

/**
 * Turns controllers, tracked hands and a development mouse into one stream of rays and gestures.
 *
 * The important behaviour here is not the plumbing but the mode machine. Robot control and workspace
 * manipulation share the same hardware, so without an explicit rule the gesture that drags a panel
 * across the room is also the gesture that pushes a joystick. The rules:
 *
 *  - grip/squeeze enters `manipulate`, and while any pointer is squeezing no control can fire;
 *  - a control fires only when select ends on the object it began on, having travelled less than
 *    ACTIVATION_SLOP_METRES, so a drag never activates anything it passes over;
 *  - hold controls start on select and cancel on any excursion, grip or tracking loss;
 *  - `navigate` is the resting state and reaches UI only.
 *
 * Controller models are drawn as a ray and a cursor rather than loaded through
 * XRControllerModelFactory, which fetches profile assets from a CDN at runtime. A control room that
 * only works with internet access would be the wrong trade for a robot interface.
 */
export class XrInputManager {
  private readonly options: XrInputManagerOptions;
  private readonly pointers = new Map<string, PointerState>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly pickable: THREE.Mesh[] = [];
  private readonly disposers: Array<() => void> = [];
  private mode: XrInteractionMode = 'navigate';

  constructor(options: XrInputManagerOptions) {
    this.options = options;
    this.raycaster.far = RAY_LENGTH;
    this.attachControllers();
  }

  get interactionMode(): XrInteractionMode {
    return this.mode;
  }

  /** Snapshot of every live pointer, for the frame context handed to panels. */
  getPointers(): XrPointer[] {
    return [...this.pointers.values()].map(state => ({
      id: state.id,
      source: state.source,
      handedness: state.handedness,
      ray: state.ray,
      selecting: state.selecting,
      squeezing: state.squeezing,
      hovered: state.hovered,
    }));
  }

  /** Pointers currently grabbing something, in a stable order — two of these means a scale gesture. */
  getGrabbingPointers(): Array<{ pointer: XrPointer; grabbed: THREE.Object3D }> {
    const result: Array<{ pointer: XrPointer; grabbed: THREE.Object3D }> = [];
    for (const state of this.pointers.values()) {
      if (!state.grabbed) continue;
      result.push({
        pointer: {
          id: state.id,
          source: state.source,
          handedness: state.handedness,
          ray: state.ray,
          selecting: state.selecting,
          squeezing: state.squeezing,
          hovered: state.hovered,
        },
        grabbed: state.grabbed,
      });
    }
    return result;
  }

  /** Full tracked pose, including wrist roll which a ray direction cannot represent. */
  getPointerPose(id: string): GrabPointerPose | null {
    const state = this.pointers.get(id);
    if (!state || !this.refreshRay(state) || !state.object) return null;
    return {
      id,
      matrixWorld: state.object.matrixWorld.clone(),
      origin: state.ray.origin.clone(),
    };
  }

  /**
   * Where a hand's wrist is, for mounting UI on it.
   *
   * Returns the controller grip when the runtime reports one and the target ray space otherwise —
   * a tracked hand has no grip, but its ray space still moves with the hand. Null when that hand
   * is not connected.
   */
  getWristPose(handedness: XRHandedness): XrWristPose | null {
    for (const state of this.pointers.values()) {
      if (!state.connected || state.handedness !== handedness || !state.object) continue;
      const source = state.grip.visible ? state.grip : state.object;
      if (!source.visible) return null;
      source.updateWorldMatrix(true, false);
      return { matrix: source.matrixWorld.clone(), tracked: true };
    }
    return null;
  }

  private refreshRay(state: PointerState): boolean {
    if (!state.connected || !state.object?.visible) return false;
    state.object.updateWorldMatrix(true, false);
    this.tempMatrix.extractRotation(state.object.matrixWorld);
    state.ray.origin.setFromMatrixPosition(state.object.matrixWorld);
    state.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix).normalize();
    return true;
  }

  private attachControllers(): void {
    // Two is what the WebXR input model exposes for handheld controllers, and matches every headset
    // Robo-Boy realistically runs on.
    for (let index = 0; index < 2; index += 1) {
      const controller = this.options.renderer.xr.getController(index);
      // The grip space is where the hand physically is; the target ray space can be offset from it
      // (and is all a tracked hand has), so both are added and the wrist pose picks between them.
      const grip = this.options.renderer.xr.getControllerGrip(index);
      const id = `controller-${index}`;
      this.options.scene.add(controller, grip);

      const rayLine = this.createRayLine();
      controller.add(rayLine);

      const state: PointerState = {
        id,
        source: 'controller',
        handedness: 'none',
        object: controller,
        ray: new THREE.Ray(),
        selecting: false,
        connected: false,
        activationTarget: null,
        pressDragging: false,
        squeezing: false,
        hovered: null,
        selectOrigin: null,
        selectOriginPoint: null,
        grabbed: null,
        rayLine,
        grip,
        inputSource: null,
        menuButtonPressed: false,
      };
      this.pointers.set(id, state);

      const onConnected = (event: XrSourceEvent) => {
        state.connected = true;
        state.handedness = event.data?.handedness ?? 'none';
        // A tracked hand reports through the same controller slot; recording it lets panels present
        // different affordances without the interaction layer branching.
        state.source = event.data?.hand ? 'hand' : 'controller';
        state.inputSource = event.data ?? null;
        // A button already held on connection must be released before it can toggle anything.
        state.menuButtonPressed = Boolean(event.data?.gamepad?.buttons[4]?.pressed);
      };
      const onDisconnected = () => {
        state.connected = false;
        state.handedness = 'none';
        state.source = 'controller';
        state.inputSource = null;
        state.menuButtonPressed = false;
        this.releaseSelect(state);
        this.releaseSqueeze(state);
        state.hovered = null;
        this.options.onHoverChange?.(this.toPointer(state), null);
      };
      const onSelectStart = () => this.beginSelect(state);
      const onSelectEnd = () => this.endSelect(state);
      const onSqueezeStart = () => this.beginSqueeze(state);
      const onSqueezeEnd = () => this.releaseSqueeze(state);

      // `connected` / `disconnected` carry the XRInputSource and are what tell us handedness and
      // whether this slot is a tracked hand. three types XRTargetRaySpace with an event map that
      // omits them, so they are reached through a narrowed view of the dispatcher rather than by
      // widening the listener signatures for the events that do typecheck.
      const sourceEvents = controller as unknown as XrSourceEventTarget;
      sourceEvents.addEventListener('connected', onConnected);
      sourceEvents.addEventListener('disconnected', onDisconnected);
      controller.addEventListener('selectstart', onSelectStart);
      controller.addEventListener('selectend', onSelectEnd);
      controller.addEventListener('squeezestart', onSqueezeStart);
      controller.addEventListener('squeezeend', onSqueezeEnd);

      this.disposers.push(() => {
        sourceEvents.removeEventListener('connected', onConnected);
        sourceEvents.removeEventListener('disconnected', onDisconnected);
        controller.removeEventListener('selectstart', onSelectStart);
        controller.removeEventListener('selectend', onSelectEnd);
        controller.removeEventListener('squeezestart', onSqueezeStart);
        controller.removeEventListener('squeezeend', onSqueezeEnd);
        controller.remove(rayLine);
        rayLine.geometry.dispose();
        (rayLine.material as THREE.Material).dispose();
        this.options.scene.remove(controller, grip);
      });
    }
  }

  private createRayLine(): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 });
    const line = new THREE.Line(geometry, material);
    line.name = 'xr-pointer-ray';
    line.scale.z = RAY_LENGTH;
    return line;
  }

  private beginSelect(state: PointerState): void {
    if (this.mode === 'manipulate' || !this.refreshRay(state)) return;
    this.releaseSelect(state);
    state.selecting = true;
    const target = this.hitTest(state);
    state.selectOrigin = target?.object ?? null;
    state.selectOriginPoint = target ? target.point.clone() : null;
    state.activationTarget = target ? this.activationTarget(target) : null;
    state.pressDragging = Boolean(target && this.options.allowsPressDrag?.(target));
    if (target && state.activationTarget != null) this.options.onPressStart?.(this.toPointer(state), target);
    this.recomputeMode();
  }

  private activationTarget(target: XrInputTarget): unknown {
    return this.options.getActivationTarget ? this.options.getActivationTarget(target) : target.object;
  }

  private endSelect(state: PointerState): void {
    const wasSelecting = state.selecting;
    const origin = state.selectOrigin;
    const originPoint = state.selectOriginPoint;
    const activationTarget = state.activationTarget;
    const manipulating = this.mode === 'manipulate';

    if (!wasSelecting || !origin) {
      this.releaseSelect(state);
      this.recomputeMode();
      return;
    }
    // A grab in progress consumes the gesture outright.
    if (manipulating || !this.refreshRay(state)) {
      this.releaseSelect(state);
      this.recomputeMode();
      return;
    }

    const target = this.hitTest(state);
    const sameTarget = target?.object === origin;
    const travelled = target && originPoint ? target.point.distanceTo(originPoint) : Number.POSITIVE_INFINITY;

    const accepted = Boolean(
      sameTarget &&
      target &&
      activationTarget != null &&
      this.activationTarget(target) === activationTarget &&
      (state.pressDragging || travelled <= ACTIVATION_SLOP_METRES)
    );
    this.releaseSelect(state, !accepted);
    if (accepted && target) {
      this.options.onActivate?.(this.toPointer(state), target);
    }
    this.recomputeMode();
  }

  private releaseSelect(state: PointerState, cancelled = true): void {
    if (state.selecting && state.activationTarget != null) this.options.onPressEnd?.(this.toPointer(state), cancelled);
    state.selecting = false;
    state.selectOrigin = null;
    state.selectOriginPoint = null;
    state.activationTarget = null;
    state.pressDragging = false;
  }

  private beginSqueeze(state: PointerState): void {
    if (!this.refreshRay(state)) return;
    // Release robot holds before moving the workspace.
    for (const pointer of this.pointers.values()) this.releaseSelect(pointer);
    state.squeezing = true;
    const target = this.hitTest(state);
    const grabbable = target ? this.findGrabbable(target.object) : null;
    if (target && grabbable) {
      state.grabbed = grabbable;
      this.options.onGrabStart?.(this.toPointer(state), { ...target, object: grabbable });
    }
    this.recomputeMode();
  }

  private releaseSqueeze(state: PointerState): void {
    const grabbed = state.grabbed;
    state.squeezing = false;
    state.grabbed = null;
    if (grabbed) this.options.onGrabEnd?.(this.toPointer(state), grabbed);
    this.recomputeMode();
  }

  /**
   * Walk up to the nearest ancestor marked grabbable, so hitting any child mesh grabs the whole.
   * An object can instead forward the grab elsewhere with `userData.xrGrabTarget` — a hit proxy that
   * must not itself move or scale with the thing it stands for.
   */
  private findGrabbable(object: THREE.Object3D): THREE.Object3D | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const forward = current.userData?.xrGrabTarget as THREE.Object3D | undefined;
      if (forward && isXrGrabbable(forward)) return forward;
      if (isXrGrabbable(current)) return current;
      current = current.parent;
    }
    return null;
  }

  private toPointer(state: PointerState): XrPointer {
    return {
      id: state.id,
      source: state.source,
      handedness: state.handedness,
      ray: state.ray,
      selecting: state.selecting,
      squeezing: state.squeezing,
      hovered: state.hovered,
    };
  }

  private recomputeMode(): void {
    let squeezing = false;
    let selectingTarget = false;
    for (const state of this.pointers.values()) {
      if (state.squeezing || state.grabbed) squeezing = true;
      if (state.selecting && state.selectOrigin) selectingTarget = true;
    }
    this.mode = squeezing ? 'manipulate' : selectingTarget ? 'control' : 'navigate';
  }

  private hitTest(state: PointerState): XrInputTarget | null {
    if (!this.refreshRay(state)) return null;
    const interactables = this.options.getInteractables();
    if (interactables.length === 0) return null;

    const candidates = this.pickable;
    candidates.length = 0;
    for (const object of interactables) {
      if (hasHiddenAncestor(object)) continue;
      object.updateWorldMatrix(true, true);
      collectPickable(object, state.handedness, candidates);
    }
    if (candidates.length === 0) return null;

    this.raycaster.set(state.ray.origin, state.ray.direction);
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    if (!hit) return null;
    return {
      object: hit.object,
      point: hit.point,
      distance: hit.distance,
      uv: hit.uv ? hit.uv.clone() : null,
    };
  }

  /**
   * Refresh every ray from its device pose and republish hover.
   *
   * Called once per XR frame before anything consumes pointers, so a panel and the grab maths see
   * the same poses within a frame.
   */
  update(): void {
    for (const state of this.pointers.values()) {
      const gamepad = state.inputSource?.gamepad;
      const menuPressed =
        state.connected &&
        state.source === 'controller' &&
        state.handedness === 'left' &&
        gamepad?.mapping === 'xr-standard' &&
        Boolean(gamepad.buttons[4]?.pressed);
      const toggle = menuPressed && !state.menuButtonPressed;
      state.menuButtonPressed = menuPressed;
      if (toggle && state.object?.visible && this.options.onMenuToggle) {
        // Opening navigation must release robot holds, including ones on the other controller.
        for (const pointer of this.pointers.values()) this.releaseSelect(pointer);
        this.options.onMenuToggle();
      }
      if (!this.refreshRay(state)) {
        this.releaseSelect(state);
        this.releaseSqueeze(state);
        if (state.hovered) this.options.onHoverChange?.(this.toPointer(state), null);
        state.hovered = null;
        continue;
      }
      const target = state.grabbed ? null : this.hitTest(state);
      // Remember excursions even when the ray returns to the original button before release.
      if (
        state.selecting &&
        (!target ||
          target.object !== state.selectOrigin ||
          !state.selectOriginPoint ||
          (!state.pressDragging && target.point.distanceTo(state.selectOriginPoint) > ACTIVATION_SLOP_METRES) ||
          this.activationTarget(target) !== state.activationTarget)
      ) {
        this.releaseSelect(state);
      }
      if (state.selecting && target) this.options.onPressMove?.(this.toPointer(state), target);
      const hovered = target?.object ?? null;
      if (hovered || hovered !== state.hovered) {
        state.hovered = hovered;
        this.options.onHoverChange?.(this.toPointer(state), target);
      }

      if (state.rayLine) {
        state.rayLine.scale.z = target ? target.distance : RAY_LENGTH;
        const material = state.rayLine.material as THREE.LineBasicMaterial;
        // Feedback without a second object: the ray brightens on anything it can act on.
        material.opacity = hovered ? 1 : 0.45;
      }
    }
    this.recomputeMode();
  }

  /** Release robot holds and grip ownership before an agent moves the room. */
  cancelInteractions(): void {
    for (const state of this.pointers.values()) this.releaseSelect(state);
    for (const state of this.pointers.values()) this.releaseSqueeze(state);
    this.recomputeMode();
  }

  dispose(): void {
    for (const state of this.pointers.values()) this.releaseSelect(state);
    for (const dispose of this.disposers.splice(0)) dispose();
    this.pointers.clear();
    this.mode = 'navigate';
  }
}
