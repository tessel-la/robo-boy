import type * as THREE from 'three';
import type { Ros } from 'roslib';
import type { XrFrameContext } from '../types';
import type { XrInputTarget } from '../XrInputManager';

/**
 * What a panel renderer is given when its spatial representation is created.
 *
 * Deliberately narrow, and deliberately not the host's React tree: a renderer receives data and a
 * DOM element, never application stores or layout control. This mirrors the boundary the external
 * panel SDK already draws in panel-sdk/index.d.ts.
 */
export interface XrPanelContext {
  /** WorkspacePanel.id — the identity a placement is stored under. */
  readonly panelId: string;
  /** WorkspacePanel.type — 'camera', '3d', a reverse-domain external id, and so on. */
  readonly panelType: string;
  readonly title: string;
  /**
   * The live DOM subtree this panel renders into in the 2D workspace, when it is mounted.
   *
   * Present because the generic fallback rasterises it. A native renderer should ignore it.
   */
  readonly domElement: HTMLElement | null;
  readonly ros: Ros | null;
  /** True when compositing over the real world, so a renderer can drop opaque backing. */
  readonly isPassthrough: boolean;
}

/**
 * One panel's spatial representation.
 *
 * `object` is added to the XR UI group by the workspace; the instance owns everything below it and
 * nothing above it.
 */
export interface XrPanelInstance {
  readonly object: THREE.Object3D;
  /** Visibility/attention changes, matching the discipline built-in 2D panels already follow. */
  setActive?(isActive: boolean): void;
  /** Called once per XR frame. Keep this cheap; it runs at headset refresh rate. */
  update?(frame: XrFrameContext): void;
  /** Optional identity for a control within a shared surface; null rejects activation. */
  getActivationTarget?(target: XrInputTarget): unknown;
  /** A completed activation on this panel's surface. */
  onActivate?(target: XrInputTarget): void;
  /** Pointer moved onto or off this panel's surface. `null` means the pointer left. */
  onHover?(target: XrInputTarget | null): void;
  dispose(): void;
}

export interface XrPanelRenderer {
  /** WorkspacePanel.type this renderer claims. */
  readonly panelType: string;
  create(context: XrPanelContext): XrPanelInstance;
}

const renderers = new Map<string, XrPanelRenderer>();
let fallback: XrPanelRenderer | null = null;

/**
 * Register a spatial renderer for a panel type.
 *
 * This is how a panel opts into XR without the XR layer knowing it exists. Nothing in src/xr/ imports
 * a panel; panels register themselves, exactly as BUILT_IN_PANELS declares catalog metadata as data
 * rather than behaviour. Re-registering a type replaces it, so a deployment can override a built-in
 * renderer without patching the registry.
 */
export const registerXrPanelRenderer = (renderer: XrPanelRenderer): void => {
  renderers.set(renderer.panelType, renderer);
};

/**
 * Install the renderer used for panel types nothing has claimed.
 *
 * Kept as a setter rather than a static import so the registry has no dependency on any concrete
 * renderer, which is what lets it be tested without pulling in Three.js DOM rasterisation.
 */
export const setFallbackXrPanelRenderer = (renderer: XrPanelRenderer | null): void => {
  fallback = renderer;
};

export const getRegisteredXrPanelTypes = (): string[] => [...renderers.keys()];

export const hasNativeXrPanelRenderer = (panelType: string): boolean => renderers.has(panelType);

/**
 * Resolve the renderer for a panel type, or the fallback.
 *
 * Returns null only when there is no fallback installed, which is a programming error rather than a
 * runtime condition — the workspace installs one before it resolves anything.
 */
export const resolveXrPanelRenderer = (panelType: string): XrPanelRenderer | null =>
  renderers.get(panelType) ?? fallback;

/** Test seam: drop every registration. Not used by application code. */
export const resetXrPanelRenderers = (): void => {
  renderers.clear();
  fallback = null;
};
