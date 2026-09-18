import * as THREE from 'three';
import {
  buildSessionInit,
  getFloorOffset,
  isPassthroughBlendMode,
  requestBestReferenceSpace,
} from './sessionModes';
import type { XrSessionMode } from './types';

export type XrFrameListener = (time: number, delta: number, frame: XRFrame | null) => void;

export interface XrSceneManagerOptions {
  /** Element the WebGL canvas is appended to. */
  container: HTMLElement;
  /** Root for the AR `dom-overlay` feature, when the deployment wants to offer one. */
  domOverlayRoot?: Element | null;
  onSessionStart?: (mode: XrSessionMode) => void;
  onSessionEnd?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Owns the WebGL renderer, scene and XR session for the immersive workspace.
 *
 * This is deliberately a second renderer rather than an extension of the 2D `Viewer` in
 * src/utils/ros3d.ts. Three reasons, all structural:
 *
 *  - The 2D viewer is invalidation-driven: `requestRender` is a single-flight requestAnimationFrame
 *    guard, and docs/performance.md makes "an idle 3D scene issues no draws" a regression contract.
 *    WebXR needs `setAnimationLoop` running continuously for as long as a session lives. One object
 *    cannot honour both.
 *  - `OrbitControls` writes camera position, quaternion and up on every input event, while
 *    `renderer.xr` owns the camera during a session. They would fight every frame.
 *  - An XRWebGLLayer binds to one WebGL context, but every open 3D panel builds its own renderer and
 *    there may be none open at all. The XR workspace has to exist independently of them.
 *
 * What is reused instead is everything below the renderer: the ROS connection, the shared TF stream,
 * and the ROS3D visualizer classes, which take a `rootObject` and so attach to this scene unchanged.
 */
export class XrSceneManager {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;

  /**
   * A camera three needs to own before a session starts; during a session `renderer.xr` drives an
   * ArrayCamera derived from it. Nothing else may write to it while a session is live.
   */
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);

  /** Robot and world visualization. Grabbable as a whole. */
  readonly worldGroup = new THREE.Group();
  /** Spatial panels. */
  readonly uiGroup = new THREE.Group();
  /** Everything that moves with the reference space's floor offset. */
  private readonly rootGroup = new THREE.Group();

  private readonly options: XrSceneManagerOptions;
  private readonly frameListeners = new Set<XrFrameListener>();
  private readonly disposables: Array<() => void> = [];

  private session: XRSession | null = null;
  private currentMode: XrSessionMode | null = null;
  private referenceSpaceType: XRReferenceSpaceType | null = null;
  private passthrough = false;
  private domOverlayGranted = false;
  private lastFrameTime = 0;
  private environment: THREE.Object3D | null = null;
  private tornDown = false;

  constructor(options: XrSceneManagerOptions) {
    this.options = options;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    // A session controls its own framebuffer scale; a device pixel ratio above 1 only costs memory
    // for the canvas that is never composited to the page during an immersive session.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(options.container.clientWidth || 1, options.container.clientHeight || 1);
    this.renderer.xr.enabled = true;
    this.renderer.setClearAlpha(0);

    options.container.appendChild(this.renderer.domElement);

    this.rootGroup.add(this.worldGroup, this.uiGroup);
    this.scene.add(this.rootGroup);
    this.addLighting();
  }

  get mode(): XrSessionMode | null {
    return this.currentMode;
  }

  get isPresenting(): boolean {
    return this.session !== null;
  }

  /** True when compositing over a view of the real world. */
  get isPassthrough(): boolean {
    return this.passthrough;
  }

  /** Whether the runtime actually granted the AR dom-overlay feature. */
  get hasDomOverlay(): boolean {
    return this.domOverlayGranted;
  }

  addFrameListener(listener: XrFrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /**
   * Lighting that reads acceptably in both modes.
   *
   * Hemisphere plus a single directional is enough for URDF meshes, which are usually flat-shaded
   * or lightly textured, and it costs one shadowless light. Shadows stay off for the same reason
   * the 2D viewer disables them.
   */
  private addLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444455, 2.2);
    const directional = new THREE.DirectionalLight(0xffffff, 1.4);
    directional.position.set(2, 4, 2);
    this.scene.add(hemisphere, directional);
    this.disposables.push(() => {
      this.scene.remove(hemisphere, directional);
      hemisphere.dispose();
      directional.dispose();
    });
  }

  /**
   * Build or clear the environment for the session's blend mode.
   *
   * In passthrough, a background or a ground plane paints over the room the user is standing in, so
   * neither is drawn. In enclosed VR both are needed: with no horizon and no ground reference the
   * scene reads as floating and is genuinely uncomfortable to stand in.
   */
  private applyEnvironment(): void {
    this.clearEnvironment();
    if (this.passthrough) {
      this.scene.background = null;
      return;
    }

    this.scene.background = new THREE.Color(0x11161d);
    const grid = new THREE.GridHelper(20, 40, 0x3a4658, 0x222b36);
    // The ROS3D viewer is Z-up, but a WebXR reference space is Y-up. The grid is authored in the
    // XR convention here; the robot world below is rotated into it as a whole instead.
    grid.position.y = 0;
    this.environment = grid;
    this.rootGroup.add(grid);
  }

  private clearEnvironment(): void {
    if (!this.environment) return;
    this.rootGroup.remove(this.environment);
    const grid = this.environment as THREE.GridHelper;
    grid.geometry?.dispose();
    const material = grid.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose());
    else material?.dispose();
    this.environment = null;
  }

  /**
   * Request a session and bind it to the renderer.
   *
   * The reference space is resolved before handing the session to three, so that a runtime which
   * advertises `local-floor` but refuses it falls back rather than failing the whole entry.
   */
  async start(mode: XrSessionMode): Promise<void> {
    if (this.tornDown) throw new Error('This XR scene has been disposed.');
    if (this.session) return;
    if (!navigator.xr) throw new Error('WebXR is unavailable in this browser.');

    const session = await navigator.xr.requestSession(
      mode,
      buildSessionInit(mode, this.options.domOverlayRoot)
    );

    try {
      const { type } = await requestBestReferenceSpace(session);
      this.referenceSpaceType = type;
      this.renderer.xr.setReferenceSpaceType(type);
      await this.renderer.xr.setSession(session);
    } catch (error) {
      // Leaving a half-bound session open would hold the headset in a blank state with no way back.
      await session.end().catch(() => undefined);
      throw error instanceof Error ? error : new Error(String(error));
    }

    this.session = session;
    this.currentMode = mode;
    this.passthrough = isPassthroughBlendMode(session.environmentBlendMode);
    this.domOverlayGranted = Boolean(
      (session as XRSession & { domOverlayState?: { type?: string } }).domOverlayState?.type
    );

    this.rootGroup.position.y = getFloorOffset(this.referenceSpaceType ?? 'local-floor');
    this.applyEnvironment();

    session.addEventListener('end', this.handleSessionEnd);

    this.lastFrameTime = 0;
    this.renderer.setAnimationLoop(this.handleFrame);
    this.options.onSessionStart?.(mode);
  }

  /** Ask the runtime to end the session. Teardown happens in the `end` handler either way. */
  async end(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await session.end();
    } catch {
      // Already ending, or ended by the runtime between the check and the call. The `end` event
      // still fires, and if it does not, handleSessionEnd is idempotent.
      this.handleSessionEnd();
    }
  }

  private readonly handleSessionEnd = (): void => {
    const session = this.session;
    this.session = null;
    this.currentMode = null;
    this.referenceSpaceType = null;
    this.passthrough = false;
    this.domOverlayGranted = false;

    session?.removeEventListener('end', this.handleSessionEnd);
    this.renderer.setAnimationLoop(null);
    this.clearEnvironment();
    this.scene.background = null;

    this.options.onSessionEnd?.();
  };

  private readonly handleFrame = (time: number, frame: XRFrame | null): void => {
    // A large delta on the first frame, or after the runtime stalls, would make anything integrating
    // against it jump. Clamped to roughly three frames at 60Hz.
    const delta = this.lastFrameTime === 0 ? 0 : Math.min((time - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = time;

    for (const listener of this.frameListeners) {
      try {
        listener(time, delta, frame);
      } catch (error) {
        // One misbehaving panel must not stop the render loop; dropping frames in a headset is
        // worse than a broken panel.
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Release everything. Safe to call more than once, and safe to call with a session still live.
   *
   * Every exit path funnels here — user exit, headset removal, ROS disconnect, unmount, error — so
   * it has to tolerate being reached twice.
   */
  dispose(): void {
    if (this.tornDown) return;
    this.tornDown = true;

    if (this.session) {
      this.session.removeEventListener('end', this.handleSessionEnd);
      void this.session.end().catch(() => undefined);
      this.session = null;
    }

    this.renderer.setAnimationLoop(null);
    this.frameListeners.clear();
    this.clearEnvironment();

    for (const dispose of this.disposables.splice(0)) dispose();

    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
  }
}
