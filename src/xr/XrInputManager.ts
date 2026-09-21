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

export interface XrInputManagerOptions {
  renderer: THREE.WebGLRenderer;
  /** Controller and hand objects are parented here. */
  scene: THREE.Object3D;
  /** Objects a ray may hit. Re-read every frame so panels can come and go. */
  getInteractables: () => readonly THREE.Object3D[];
  /**
   * A completed activation: select began and ended on the same target without becoming a drag.
   * This is the only path by which a control surface may reach the robot.
   */
  onActivate?: (pointer: XrPointer, target: XrInputTarget) => void;
  onHoverChange?: (pointer: XrPointer, target: XrInputTarget | null) => void;
  onGrabStart?: (pointer: XrPointer, target: XrInputTarget) => void;
  onGrabEnd?: (pointer: XrPointer, object: THREE.Object3D) => void;
  /** Identity of the actual control within a surface, not just its shared mesh. */
  getActivationTarget?: (target: XrInputTarget) => unknown;
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
  squeezing: boolean;
  hovered: THREE.Object3D | null;
  /** What select began on, so an activation can require it to end on the same thing. */
  selectOrigin: THREE.Object3D | null;
  /** Where select began, so a drag can be told from a press. */
  selectOriginPoint: THREE.Vector3 | null;
  grabbed: THREE.Object3D | null;
  rayLine: THREE.Line | null;
}

/** Beyond this much travel, a select is a drag and must not activate anything. */
const ACTIVATION_SLOP_METRES = 0.05;

/** The input-source lifecycle events three does not include in XRTargetRaySpace's event map. */
type XrSourceEvent = { data?: XRInputSource };
interface XrSourceEventTarget {
  addEventListener(type: 'connected' | 'disconnected', listener: (event: XrSourceEvent) => void): void;
  removeEventListener(
    type: 'connected' | 'disconnected',
    listener: (event: XrSourceEvent) => void
  ): void;
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
      const id = `controller-${index}`;
      this.options.scene.add(controller);

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
        squeezing: false,
        hovered: null,
        selectOrigin: null,
        selectOriginPoint: null,
        grabbed: null,
        rayLine,
      };
      this.pointers.set(id, state);

      const onConnected = (event: XrSourceEvent) => {
        state.connected = true;
        state.handedness = event.data?.handedness ?? 'none';
        // A tracked hand reports through the same controller slot; recording it lets panels present
        // different affordances without the interaction layer branching.
        state.source = event.data?.hand ? 'hand' : 'controller';
      };
      const onDisconnected = () => {
        state.connected = false;
        state.handedness = 'none';
        state.source = 'controller';
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
        this.options.scene.remove(controller);
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
    state.selecting = true;
    const target = this.hitTest(state);
    state.selectOrigin = target?.object ?? null;
    state.selectOriginPoint = target ? target.point.clone() : null;
    state.activationTarget = target ? this.activationTarget(target) : null;
    this.recomputeMode();
  }

  private activationTarget(target: XrInputTarget): unknown {
    return this.options.getActivationTarget
      ? this.options.getActivationTarget(target)
      : target.object;
  }

  private endSelect(state: PointerState): void {
    const wasSelecting = state.selecting;
    const origin = state.selectOrigin;
    const originPoint = state.selectOriginPoint;
    const activationTarget = state.activationTarget;
    const manipulating = this.mode === 'manipulate';
    this.releaseSelect(state);

    if (!wasSelecting || !origin) {
      this.recomputeMode();
      return;
    }
    // A grab in progress consumes the gesture outright.
    if (manipulating || !this.refreshRay(state)) {
      this.recomputeMode();
      return;
    }

    const target = this.hitTest(state);
    const sameTarget = target?.object === origin;
    const travelled =
      target && originPoint ? target.point.distanceTo(originPoint) : Number.POSITIVE_INFINITY;

    if (sameTarget && target && activationTarget != null &&
        this.activationTarget(target) === activationTarget && travelled <= ACTIVATION_SLOP_METRES) {
      this.options.onActivate?.(this.toPointer(state), target);
    }
    this.recomputeMode();
  }

  private releaseSelect(state: PointerState): void {
    state.selecting = false;
    state.selectOrigin = null;
    state.selectOriginPoint = null;
    state.activationTarget = null;
  }

  private beginSqueeze(state: PointerState): void {
    if (!this.refreshRay(state)) return;
    state.squeezing = true;
    const target = this.hitTest(state);
    const grabbable = target ? this.findGrabbable(target.object) : null;
    if (target && grabbable) {
      state.grabbed = grabbable;
      this.options.onGrabStart?.(this.toPointer(state), { ...target, object: grabbable });
    }
    // Grip outranks trigger: any select in flight is abandoned so it cannot activate on release.
    for (const pointer of this.pointers.values()) this.releaseSelect(pointer);
    this.recomputeMode();
  }

  private releaseSqueeze(state: PointerState): void {
    const grabbed = state.grabbed;
    state.squeezing = false;
    state.grabbed = null;
    if (grabbed) this.options.onGrabEnd?.(this.toPointer(state), grabbed);
    this.recomputeMode();
  }

  /** Walk up to the nearest ancestor marked grabbable, so hitting any child mesh grabs the whole. */
  private findGrabbable(object: THREE.Object3D): THREE.Object3D | null {
    let current: THREE.Object3D | null = object;
    while (current) {
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

    for (const object of interactables) object.updateWorldMatrix(true, true);
    this.raycaster.set(state.ray.origin, state.ray.direction);
    const intersections = this.raycaster.intersectObjects(interactables as THREE.Object3D[], true);
    const hit = intersections.find(entry => {
      for (let object: THREE.Object3D | null = entry.object; object; object = object.parent) {
        if (!object.visible) return false;
      }
      return true;
    });
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
      if (!this.refreshRay(state)) {
        this.releaseSelect(state);
        this.releaseSqueeze(state);
        if (state.hovered) this.options.onHoverChange?.(this.toPointer(state), null);
        state.hovered = null;
        continue;
      }
      const target = state.grabbed ? null : this.hitTest(state);
      // Remember excursions even when the ray returns to the original button before release.
      if (state.selecting && (!target || target.object !== state.selectOrigin ||
          !state.selectOriginPoint || target.point.distanceTo(state.selectOriginPoint) > ACTIVATION_SLOP_METRES ||
          this.activationTarget(target) !== state.activationTarget)) {
        this.releaseSelect(state);
      }
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

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.pointers.clear();
    this.mode = 'navigate';
  }
}
