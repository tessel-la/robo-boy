import * as THREE from 'three';
import { subscribeXrTheme } from './xrTheme';

export interface SurfaceItemState {
  hover: boolean;
}

/** A rectangular hit region in canvas pixels (origin top-left) with its own drawing and action. */
export interface SurfaceItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  draw: (ctx: CanvasRenderingContext2D, item: SurfaceItem, state: SurfaceItemState) => void;
  /** Absent for purely decorative regions. Disabled items draw but never activate. */
  onPress?: () => void;
  disabled?: boolean;
}

export interface SpatialSurfaceOptions {
  /** Physical size in metres. */
  width: number;
  height: number;
  /** Texture density. 1400 keeps 30px type legible at arm's length without huge textures. */
  pixelsPerMetre?: number;
  /** Painted first, under every item. */
  drawBackground?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

let nextSurfaceId = 0;

/**
 * One canvas-textured quad that hosts a set of pressable regions.
 *
 * This is the primitive every native XR control is built from. A ray hit yields a texture
 * coordinate, the coordinate resolves to an item, and the item is drawn, highlighted and activated
 * from there — so a toolbar, a paged menu and a wrist menu differ only in the items they supply.
 * Redrawing happens on demand (items changed or hover changed), never per frame.
 */
export class SpatialSurface {
  readonly uid = `surface-${(nextSurfaceId += 1)}`;
  readonly mesh: THREE.Mesh;
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly drawBackground?: SpatialSurfaceOptions['drawBackground'];
  private readonly stopTheme: () => void;
  private items: SurfaceItem[] = [];
  private readonly hoverByPointer = new Map<string, string>();

  constructor(options: SpatialSurfaceOptions) {
    const density = options.pixelsPerMetre ?? 1400;
    this.width = options.width;
    this.height = options.height;
    this.pixelWidth = Math.max(1, Math.round(options.width * density));
    this.pixelHeight = Math.max(1, Math.round(options.height * density));
    this.drawBackground = options.drawBackground;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;
    // A null context (lost, or an environment with no canvas) leaves a blank but still pickable
    // surface; the alternative is throwing while a headset session is starting.
    this.context = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.width, options.height), material);
    this.mesh.userData.xrSurface = this;
    this.mesh.renderOrder = 5;
    this.stopTheme = subscribeXrTheme(() => this.redraw());
    this.redraw();
  }

  setItems(items: SurfaceItem[]): void {
    this.items = items;
    const live = new Set(items.map(item => item.id));
    for (const [pointerId, itemId] of this.hoverByPointer) {
      if (!live.has(itemId)) this.hoverByPointer.delete(pointerId);
    }
    this.redraw();
  }

  getItem(id: string): SurfaceItem | null {
    return this.items.find(item => item.id === id) ?? null;
  }

  /** Resolve a texture coordinate (origin bottom-left) to the topmost item under it. */
  itemAt(uv: THREE.Vector2 | null): SurfaceItem | null {
    if (!uv) return null;
    const x = uv.x * this.pixelWidth;
    const y = (1 - uv.y) * this.pixelHeight;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (!item.onPress) continue;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) return item;
    }
    return null;
  }

  /** Record what one pointer is over, redrawing only when that changes what is highlighted. */
  setHover(pointerId: string, itemId: string | null): void {
    const previous = this.hoverByPointer.get(pointerId) ?? null;
    if (previous === itemId) return;
    if (itemId === null) this.hoverByPointer.delete(pointerId);
    else this.hoverByPointer.set(pointerId, itemId);
    this.redraw();
  }

  clearHover(pointerId: string): void {
    this.setHover(pointerId, null);
  }

  redraw(): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    this.drawBackground?.(ctx, this.pixelWidth, this.pixelHeight);
    const hovered = new Set(this.hoverByPointer.values());
    for (const item of this.items) {
      ctx.save();
      item.draw(ctx, item, { hover: hovered.has(item.id) && !item.disabled });
      ctx.restore();
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.stopTheme();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.items = [];
    this.hoverByPointer.clear();
  }
}

export const getSurfaceOf = (object: THREE.Object3D | null): SpatialSurface | null =>
  (object?.userData?.xrSurface as SpatialSurface | undefined) ?? null;
