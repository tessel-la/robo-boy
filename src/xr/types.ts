/// <reference types="webxr" />

// The WebXR DOM types ship with @types/webxr, which arrives as a dependency of @types/three.
// tsconfig.json pins `types` to the test globals, so nothing pulls those declarations in
// automatically; this reference makes them available wherever the XR layer is compiled without
// widening the shared compiler configuration for the rest of the application.

import type * as THREE from 'three';

/**
 * The two immersive session modes Robo-Boy offers.
 *
 * They are separate capabilities rather than one flag: a headset may present enclosed VR, AR
 * passthrough, both, or neither, and the entry point has to reflect what the device actually
 * reports rather than assuming a headset.
 */
export type XrSessionMode = 'immersive-vr' | 'immersive-ar';

/** What `navigator.xr` says this device can do. */
export interface XrSupport {
  readonly vr: boolean;
  readonly ar: boolean;
  /** True until the first probe resolves, so the UI can avoid flashing an entry point in and out. */
  readonly isChecking: boolean;
}

/**
 * A placement in the XR workspace, in metres, relative to the session's reference space.
 *
 * Stored as plain arrays rather than THREE types because this shape is persisted: the storage rule
 * in docs/architecture.md is to keep domain definitions, never live Three.js objects.
 */
export interface XrPose {
  position: [number, number, number];
  /** x, y, z, w — the order THREE.Quaternion.toArray produces. */
  quaternion: [number, number, number, number];
  /** Uniform. Non-uniform scaling a panel would distort its rasterised text. */
  scale: number;
}

/**
 * Whether a placement is fixed in the room or carried with the viewer.
 *
 * `world` is the control-room behaviour: the panel stays where it was put. `viewer` keeps a panel
 * in front of the user as they walk, for things worth never losing sight of.
 */
export type XrAttachMode = 'world' | 'viewer';

export interface XrPanelPlacement {
  pose: XrPose;
  /** Pinned placements are excluded from automatic re-layout. */
  pinned: boolean;
  attach: XrAttachMode;
}

export interface XrWorkspaceState {
  version: 1;
  /** Keyed by WorkspacePanel.id, so a panel removed in 2D simply stops being referenced. */
  panels: Record<string, XrPanelPlacement>;
  /** Transform of the robot/world visualization. */
  world?: XrPose;
  /** Transform of the control desk, once native pads land. */
  desk?: XrPose;
}

/**
 * What the user's input is currently doing.
 *
 * This exists to keep workspace manipulation and robot control from ever being the same gesture.
 * A control can only publish in `control`, and entering `manipulate` is what a grip does, so
 * dragging a panel across a joystick cannot drive the robot.
 */
export type XrInteractionMode = 'navigate' | 'manipulate' | 'control';

/** Which physical thing a ray came from. */
export type XrPointerSource = 'controller' | 'hand' | 'mouse';

/**
 * One ray into the scene.
 *
 * Controllers, tracked hands and the development mouse all reduce to this, so interaction code
 * never branches on the device that produced the gesture.
 */
export interface XrPointer {
  readonly id: string;
  readonly source: XrPointerSource;
  /** Handedness where the runtime reports one; 'none' for the mouse and for untracked sources. */
  readonly handedness: XRHandedness;
  readonly ray: THREE.Ray;
  /** True while the primary action (trigger / pinch / left button) is held. */
  readonly selecting: boolean;
  /** True while the grab action (grip / squeeze) is held. */
  readonly squeezing: boolean;
  /** The scene object this ray currently resolves to, if any. */
  readonly hovered: THREE.Object3D | null;
}

/** Per-frame context handed to anything that needs to update with the session. */
export interface XrFrameContext {
  /** Seconds since the previous frame. */
  readonly delta: number;
  /** DOMHighResTimeStamp from the XR frame callback. */
  readonly time: number;
  readonly mode: XrSessionMode;
  readonly pointers: readonly XrPointer[];
  readonly interaction: XrInteractionMode;
}

/**
 * Marks an object as manipulable and carries the identity its placement is saved under.
 *
 * Attached to an Object3D's `userData` so a hit test can walk up from whatever mesh the ray struck
 * to the thing the user meant to grab, without the interaction layer knowing what kind of object
 * it is.
 */
export interface XrGrabbableData {
  readonly xrGrabbable: true;
  /** Storage key: a WorkspacePanel id, or one of the reserved names below. */
  readonly placementId: string;
  readonly allowScale: boolean;
}

/** Reserved placement ids for things that are not panels. */
export const XR_WORLD_PLACEMENT_ID = '__world__';
export const XR_DESK_PLACEMENT_ID = '__desk__';

export const isXrGrabbable = (object: THREE.Object3D): boolean =>
  (object.userData as Partial<XrGrabbableData> | undefined)?.xrGrabbable === true;
