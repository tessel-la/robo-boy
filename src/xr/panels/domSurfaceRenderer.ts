import * as THREE from 'three';
import { HTMLMesh } from 'three/examples/jsm/interactive/HTMLMesh.js';
import type { XrGrabbableData } from '../types';
import type { XrInputTarget } from '../XrInputManager';
import type { XrPanelContext, XrPanelInstance, XrPanelRenderer } from './registry';

/** Every panel surface is normalised to this width in metres, whatever its pixel size. */
const TARGET_WIDTH_METRES = 0.9;
const MAX_HEIGHT_METRES = 0.9;

/** Placeholder quad proportions, used when there is nothing to rasterise. */
const PLACEHOLDER_ASPECT = 16 / 10;

/**
 * Why a panel cannot be shown as a rasterised surface.
 *
 * Detected from the DOM rather than from a list of panel types, so the XR layer does not have to
 * know which panels exist — a new panel that embeds a video gets the right treatment without
 * anything here changing.
 */
type UnrasterizableReason = 'iframe' | 'video' | 'empty';

const describeReason = (reason: UnrasterizableReason): string => {
  switch (reason) {
    case 'iframe':
      // External panels run in a sandboxed iframe, whose contents are cross-origin by construction.
      return 'Sandboxed panel content cannot be mirrored into XR. This panel needs a native XR renderer.';
    case 'video':
      return 'Live video cannot be mirrored into XR. This panel needs a native XR renderer.';
    case 'empty':
      return 'This panel is not mounted in the 2D workspace, so there is nothing to mirror.';
  }
};

/**
 * Decide whether a DOM subtree can be rasterised usefully.
 *
 * Three's rasteriser draws text, boxes, images, canvases and form controls. It has no `<video>` or
 * `<iframe>` path at all, so those render as empty space — a black quad that looks like a bug rather
 * than a limitation. Naming the limitation is the better failure.
 */
export const findUnrasterizableReason = (
  element: HTMLElement | null
): UnrasterizableReason | null => {
  if (!element) return 'empty';
  if (element.querySelector('iframe')) return 'iframe';
  if (element.querySelector('video')) return 'video';
  if (element.offsetWidth === 0 || element.offsetHeight === 0) return 'empty';
  return null;
};

const disposeObject = (object: THREE.Object3D): void => {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach(entry => {
        (entry as THREE.MeshBasicMaterial).map?.dispose();
        entry.dispose();
      });
    } else if (material) {
      (material as THREE.MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
  });
};

/** Draw a labelled placeholder so a panel that cannot be mirrored still reads as itself. */
const createPlaceholder = (title: string, message: string, passthrough: boolean): THREE.Mesh => {
  const width = 768;
  const height = Math.round(width / PLACEHOLDER_ASPECT);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (context) {
    // In passthrough the surface sits over the real room, so it is kept translucent rather than
    // painting a slab over whatever is behind it.
    context.fillStyle = passthrough ? 'rgba(14, 19, 26, 0.72)' : '#0e131a';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#3a4658';
    context.lineWidth = 4;
    context.strokeRect(2, 2, width - 4, height - 4);

    context.fillStyle = '#e5ebf1';
    context.font = '600 34px system-ui, sans-serif';
    context.fillText(title, 40, 72);

    context.fillStyle = '#94a3b0';
    context.font = '24px system-ui, sans-serif';
    const words = message.split(' ');
    let line = '';
    let y = 140;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > width - 80) {
        context.fillText(line, 40, y);
        line = word;
        y += 34;
      } else {
        line = candidate;
      }
    }
    if (line) context.fillText(line, 40, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(
    TARGET_WIDTH_METRES,
    TARGET_WIDTH_METRES / PLACEHOLDER_ASPECT
  );
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
  return new THREE.Mesh(geometry, material);
};

/**
 * The generic spatial representation for any panel with no XR renderer of its own.
 *
 * The 2D panel stays mounted and is mirrored onto a quad, which is what makes this work at all: the
 * DOM has to keep existing and keep updating for there to be anything to rasterise. Three's
 * HTMLTexture already re-rasterises on a MutationObserver with a frame of debounce rather than every
 * frame, which is the behaviour we want — rebuilding panel textures per frame would not hold a
 * headset's refresh rate.
 */
class DomSurfacePanel implements XrPanelInstance {
  readonly object = new THREE.Group();
  private readonly surface: THREE.Mesh;
  private readonly isMirror: boolean;
  private readonly highlight: THREE.Mesh;

  constructor(context: XrPanelContext) {
    const reason = findUnrasterizableReason(context.domElement);

    if (reason || !context.domElement) {
      this.surface = createPlaceholder(context.title, describeReason(reason ?? 'empty'), context.isPassthrough);
      this.isMirror = false;
    } else {
      const mesh = new HTMLMesh(context.domElement);
      // HTMLMesh sizes its plane at one millimetre per pixel, so a wide panel would arrive metres
      // across. Normalising to a readable arm's-length size keeps every panel comparable.
      const bounds = new THREE.Box3().setFromObject(mesh);
      const size = bounds.getSize(new THREE.Vector3());
      const widthScale = size.x > 0 ? TARGET_WIDTH_METRES / size.x : 1;
      const heightScale = size.y > 0 ? MAX_HEIGHT_METRES / size.y : widthScale;
      mesh.scale.setScalar(Math.min(widthScale, heightScale));
      this.surface = mesh;
      this.isMirror = true;
    }

    this.object.name = `xr-panel-${context.panelId}`;
    this.object.add(this.surface);

    // A thin frame behind the surface gives the panel an edge to aim at and somewhere to show
    // hover feedback without tinting the content.
    this.highlight = this.createHighlight();
    this.object.add(this.highlight);

    const grabbable: XrGrabbableData = {
      xrGrabbable: true,
      placementId: context.panelId,
      allowScale: true,
    };
    this.object.userData = { ...this.object.userData, ...grabbable };
  }

  private createHighlight(): THREE.Mesh {
    const bounds = new THREE.Box3().setFromObject(this.surface);
    const size = bounds.getSize(new THREE.Vector3());
    const geometry = new THREE.PlaneGeometry(
      Math.max(size.x, 0.1) * 1.04,
      Math.max(size.y, 0.1) * 1.06
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0x4fa8e6,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.005;
    mesh.name = 'xr-panel-highlight';
    return mesh;
  }

  onHover(target: XrInputTarget | null): void {
    const material = this.highlight.material as THREE.MeshBasicMaterial;
    material.opacity = target ? 0.35 : 0;
  }

  /**
   * Replay an activation onto the real DOM.
   *
   * HTMLMesh listens for three events carrying the normalized surface coordinate and converts it
   * back into an element-space position, so a trigger press in a headset reaches the same handler a
   * mouse click would. Only the mirror path can do this; a placeholder has nothing behind it.
   */
  onActivate(target: XrInputTarget): void {
    if (!this.isMirror || !target.uv) return;
    const data = new THREE.Vector2(target.uv.x, 1 - target.uv.y);
    const surface = this.surface as unknown as THREE.EventDispatcher<Record<string, unknown>>;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      surface.dispatchEvent({ type, data } as never);
    }
  }

  dispose(): void {
    const disposable = this.surface as THREE.Mesh & { dispose?: () => void };
    // HTMLMesh installs its own dispose, which also disconnects the MutationObserver feeding the
    // texture. Leaving that observer attached would keep rasterising a panel nobody is looking at.
    if (typeof disposable.dispose === 'function') disposable.dispose();
    else disposeObject(this.surface);
    disposeObject(this.highlight);
    this.object.clear();
  }
}

export const domSurfaceRenderer: XrPanelRenderer = {
  panelType: '*',
  create: context => new DomSurfacePanel(context),
};
