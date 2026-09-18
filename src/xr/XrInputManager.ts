import * as THREE from 'three';
import type { XrInteractionMode, XrPointer, XrPointerSource } from './types';
import { isXrGrabbable } from './types';

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
  onGrabEnd?: (pointer: XrPointer) => void;
}

interface PointerState {
  id: string;
  source: XrPointerSource;
  handedness: XRHandedness;
  object: THREE.Object3D | null;
  ray: THREE.Ray;
  selecting: boolean;
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

  /** World-space origin of a pointer, used by the grab maths. */
  getPointerOrigin(id: string): THREE.Vector3 | null {
    const state = this.pointers.get(id);
    return state ? state.ray.origin.clone() : null;
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
        squeezing: false,
        hovered: null,
        selectOrigin: null,
        selectOriginPoint: null,
        grabbed: null,
        rayLine,
      };
      this.pointers.set(id, state);

      const onConnected = (event: XrSourceEvent) => {
        state.handedness = event.data?.handedness ?? 'none';
        // A tracked hand reports through the same controller slot; recording it lets panels present
        // different affordances without the interaction layer branching.
        state.source = event.data?.hand ? 'hand' : 'controller';
      };
      const onDisconnected = () => {
        state.handedness = 'none';
        state.source = 'controller';
        this.releaseSelect(state);
        this.releaseSqueeze(state);
        state.hovered = null;
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
    state.selecting = true;
    const target = this.hitTest(state);
    state.selectOrigin = target?.object ?? null;
    state.selectOriginPoint = target ? target.point.clone() : null;

    // A squeeze already in progress owns the gesture; select must not also start a grab.
    if (!state.squeezing && target && isXrGrabbable(target.object)) {
      // Select on a grabbable is still a candidate activation, not a grab. Grabbing requires grip,
      // which is what keeps a pointing gesture from dragging the room.
      this.recomputeMode();
      return;
    }
    this.recomputeMode();
  }

  private endSelect(state: PointerState): void {
    const wasSelecting = state.selecting;
    const origin = state.selectOrigin;
    const originPoint = state.selectOriginPoint;
    this.releaseSelect(state);

    if (!wasSelecting || !origin) {
      this.recomputeMode();
      return;
    }
    // A grab in progress consumes the gesture outright.
    if (state.squeezing || state.grabbed) {
      this.recomputeMode();
      return;
    }

    const target = this.hitTest(state);
    const sameTarget = target?.object === origin;
    const travelled =
      target && originPoint ? target.point.distanceTo(originPoint) : Number.POSITIVE_INFINITY;

    if (sameTarget && target && travelled <= ACTIVATION_SLOP_METRES) {
      this.options.onActivate?.(this.toPointer(state), target);
    }
    this.recomputeMode();
  }

  private releaseSelect(state: PointerState): void {
    state.selecting = false;
    state.selectOrigin = null;
    state.selectOriginPoint = null;
  }

  private beginSqueeze(state: PointerState): void {
    state.squeezing = true;
    const target = this.hitTest(state);
    const grabbable = target ? this.findGrabbable(target.object) : null;
    if (target && grabbable) {
      state.grabbed = grabbable;
      this.options.onGrabStart?.(this.toPointer(state), { ...target, object: grabbable });
    }
    // Grip outranks trigger: any select in flight is abandoned so it cannot activate on release.
    this.releaseSelect(state);
    this.recomputeMode();
  }

  private releaseSqueeze(state: PointerState): void {
    const wasGrabbing = state.grabbed !== null;
    state.squeezing = false;
    state.grabbed = null;
    if (wasGrabbing) this.options.onGrabEnd?.(this.toPointer(state));
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
    const interactables = this.options.getInteractables();
    if (interactables.length === 0) return null;

    this.raycaster.set(state.ray.origin, state.ray.direction);
    const intersections = this.raycaster.intersectObjects(interactables as THREE.Object3D[], true);
    const hit = intersections.find(entry => entry.object.visible);
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
      const object = state.object;
      if (!object) continue;

      object.updateMatrixWorld();
      this.tempMatrix.identity().extractRotation(object.matrixWorld);
      state.ray.origin.setFromMatrixPosition(object.matrixWorld);
      state.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix).normalize();

      const target = state.grabbed ? null : this.hitTest(state);
      const hovered = target?.object ?? null;
      if (hovered !== state.hovered) {
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
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.pointers.clear();
    this.mode = 'navigate';
  }
}
