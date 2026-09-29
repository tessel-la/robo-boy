import * as THREE from 'three';
import type { XrGrabbableData } from '../types';
import { SpatialMenu } from './SpatialMenu';
import { SpatialSurface, type SurfaceItem } from './SpatialSurface';
import { SpatialToolbar, type ToolbarButton } from './SpatialToolbar';
import { XR_THEME, drawIcon, drawText, fillRoundRect, strokeRoundRect } from './canvasKit';

export const FRAME_SCALE_LIMITS = { min: 0.3, max: 3 } as const;

export interface PanelFrameOptions {
  panelId: string;
  title: string;
  isPassthrough: boolean;
  /** Flat data panels share the chrome without a floor or a projecting toolbar. */
  layout?: 'stage' | 'surface';
  onClose: () => void;
  /** Called after the frame changes its own placement (a size step), so it can be persisted. */
  onPlacementChange: () => void;
}

const STAGE_WIDTH = 0.9;
const STAGE_HEIGHT = 0.7;
/** Radius of the round floor the panel's world stands on; the stage is as deep as it is tall. */
const STAGE_RADIUS = 0.36;
const FLOOR_MARGIN = 0.05;
const TITLE_HEIGHT = 0.08;
const SIZE_STEP = 1.18;

/**
 * The spatial chrome around one panel: a backdrop, a floor for its world to stand on, a title bar,
 * a toolbar below and a dock for its settings menu.
 *
 * It owns nothing about what the panel shows. A panel gets `viewRoot` (an origin on the floor's
 * centre, Y-up) to build its world under, hands the frame a list of toolbar buttons, and attaches a
 * `SpatialMenu` — which is what lets every future panel type share the same movement, sizing,
 * closing and settings behaviour.
 *
 * Layout, in frame space (origin at the stage centre, -Z away from the user): the backdrop stands at
 * the back of the stage, the title bar sits on its top edge, the toolbar tilts up towards the user
 * beneath the floor's front edge, and the settings menu docks to the backdrop's right edge, turned
 * slightly inward. Beside the panel rather than below it, so it stays at chest height instead of
 * hanging down to the knees.
 */
export class PanelFrame {
  readonly object = new THREE.Group();
  /** Stage: floor centre. Surface: lower edge against the backdrop. Content is parented here. */
  readonly viewRoot = new THREE.Group();
  readonly stageRadius = STAGE_RADIUS;
  readonly stageHeight = STAGE_HEIGHT - FLOOR_MARGIN * 2;

  private readonly options: PanelFrameOptions;
  private readonly title: SpatialSurface;
  private readonly toolbar = new SpatialToolbar(STAGE_WIDTH);
  private readonly menuDock = new THREE.Group();
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  private menu: SpatialMenu | null = null;
  private titleText: string;
  private panelButtons: readonly ToolbarButton[] = [];
  private sizeLimitState = '';
  private subtitleText = '';

  constructor(options: PanelFrameOptions) {
    this.options = options;
    this.titleText = options.title;
    const floorY = -STAGE_HEIGHT / 2 + FLOOR_MARGIN;

    this.object.userData = {
      xrGrabbable: true,
      placementId: options.panelId,
      allowScale: true,
      constrain: object => {
        object.scale.setScalar(
          THREE.MathUtils.clamp(object.scale.x, FRAME_SCALE_LIMITS.min, FRAME_SCALE_LIMITS.max)
        );
        this.syncSizeButtons();
      },
    } satisfies XrGrabbableData;

    this.object.add(this.buildBackdrop(options.isPassthrough));
    if (options.layout !== 'surface') this.object.add(this.buildFloor(floorY));

    this.viewRoot.position.set(0, floorY, 0);
    if (options.layout === 'surface') this.viewRoot.position.z = -STAGE_RADIUS + 0.01;
    this.object.add(this.viewRoot);

    this.title = new SpatialSurface({
      width: STAGE_WIDTH,
      height: TITLE_HEIGHT,
      drawBackground: (ctx, w, h) => {
        fillRoundRect(ctx, 0, 0, w, h, 24, XR_THEME.surface);
        strokeRoundRect(ctx, 1.5, 1.5, w - 3, h - 3, 23, XR_THEME.surfaceBorder, 3);
      },
    });
    this.title.mesh.position.set(0, STAGE_HEIGHT / 2 + TITLE_HEIGHT / 2 + 0.015, -STAGE_RADIUS);
    this.object.add(this.title.mesh);
    this.drawTitle();

    this.toolbar.surface.mesh.position.set(0, floorY - 0.075, STAGE_RADIUS * 0.85);
    this.toolbar.surface.mesh.rotation.x = -0.5;
    if (options.layout === 'surface') {
      this.toolbar.surface.mesh.position.z = -STAGE_RADIUS + 0.01;
      this.toolbar.surface.mesh.rotation.x = 0;
    }
    this.object.add(this.toolbar.surface.mesh);

    this.menuDock.position.set(STAGE_WIDTH / 2 + 0.04, STAGE_HEIGHT / 2, -STAGE_RADIUS + 0.02);
    this.menuDock.rotation.y = -0.35;
    this.object.add(this.menuDock);
  }

  setTitle(title: string, subtitle = ''): void {
    this.titleText = title;
    this.subtitleText = subtitle;
    this.drawTitle();
  }

  /** The frame appends its own size buttons, so panels only describe what is specific to them. */
  setToolbar(buttons: readonly ToolbarButton[]): void {
    this.panelButtons = buttons;
    this.sizeLimitState = this.currentSizeLimitState();
    this.toolbar.setButtons([
      ...buttons,
      {
        id: 'frame-smaller',
        icon: 'shrink',
        label: 'Smaller',
        disabled: this.object.scale.x <= FRAME_SCALE_LIMITS.min + 1e-6,
        onPress: () => this.stepSize(1 / SIZE_STEP),
      },
      {
        id: 'frame-larger',
        icon: 'grow',
        label: 'Larger',
        disabled: this.object.scale.x >= FRAME_SCALE_LIMITS.max - 1e-6,
        onPress: () => this.stepSize(SIZE_STEP),
      },
    ]);
  }

  attachMenu(menu: SpatialMenu): void {
    this.menu = menu;
    menu.object.position.set(menu.width / 2, -menu.height / 2, 0);
    this.menuDock.add(menu.object);
  }

  private currentSizeLimitState(): string {
    const scale = this.object.scale.x;
    return `${scale <= FRAME_SCALE_LIMITS.min + 1e-6}:${scale >= FRAME_SCALE_LIMITS.max - 1e-6}`;
  }

  /** A grab can resize the frame, so the size buttons follow it — redrawn only when they change. */
  private syncSizeButtons(): void {
    if (this.currentSizeLimitState() !== this.sizeLimitState) this.setToolbar(this.panelButtons);
  }

  /** Resize the whole panel about its centre, within limits, and persist the result. */
  stepSize(factor: number): void {
    const next = THREE.MathUtils.clamp(
      this.object.scale.x * factor,
      FRAME_SCALE_LIMITS.min,
      FRAME_SCALE_LIMITS.max
    );
    this.object.scale.setScalar(next);
    this.object.updateWorldMatrix(true, false);
    this.options.onPlacementChange();
  }

  private drawTitle(): void {
    const { pixelWidth, pixelHeight } = this.title;
    const closeSize = pixelHeight - 20;
    const items: SurfaceItem[] = [
      {
        id: 'title',
        x: 24,
        y: 0,
        w: pixelWidth - closeSize - 60,
        h: pixelHeight,
        draw: ctx => {
          drawText(ctx, this.titleText, 28, pixelHeight / 2, pixelWidth * 0.5, { size: 38, weight: 700 });
          if (this.subtitleText) {
            drawText(ctx, this.subtitleText, pixelWidth - closeSize - 48, pixelHeight / 2, pixelWidth * 0.34, {
              size: 26,
              color: XR_THEME.textMuted,
              align: 'right',
            });
          }
        },
      },
      {
        id: 'close',
        x: pixelWidth - closeSize - 12,
        y: 10,
        w: closeSize,
        h: closeSize,
        onPress: this.options.onClose,
        draw: (ctx, item, state) => {
          fillRoundRect(ctx, item.x, item.y, item.w, item.h, 16, state.hover ? XR_THEME.danger : XR_THEME.item);
          drawIcon(ctx, 'close', item.x + item.w / 2, item.y + item.h / 2, item.h * 0.42, state.hover ? '#fff' : XR_THEME.danger);
        },
      },
    ];
    this.title.setItems(items);
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  private buildBackdrop(passthrough: boolean): THREE.Object3D {
    const group = new THREE.Group();
    const geometry = this.track(new THREE.PlaneGeometry(STAGE_WIDTH, STAGE_HEIGHT));
    const plate = new THREE.Mesh(
      geometry,
      this.track(
        new THREE.MeshBasicMaterial({
          color: 0x0e131a,
          transparent: true,
          // Over the real room a solid slab hides what the user is standing in.
          opacity: passthrough ? 0.4 : 0.88,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      )
    );
    const outline = new THREE.LineSegments(
      this.track(new THREE.EdgesGeometry(geometry)),
      this.track(new THREE.LineBasicMaterial({ color: 0x33404e }))
    );
    group.add(plate, outline);
    group.position.z = -STAGE_RADIUS;
    return group;
  }

  private buildFloor(floorY: number): THREE.Object3D {
    const group = new THREE.Group();
    const disc = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(STAGE_RADIUS, STAGE_RADIUS, 0.012, 64)),
      this.track(new THREE.MeshBasicMaterial({ color: 0x18202a, transparent: true, opacity: 0.92 }))
    );
    disc.position.y = floorY - 0.006;
    group.add(disc);

    const ringMaterial = this.track(new THREE.LineBasicMaterial({ color: 0x3a4658 }));
    for (const fraction of [1 / 3, 2 / 3, 1]) {
      const points: THREE.Vector3[] = [];
      for (let step = 0; step < 64; step += 1) {
        const angle = (step / 64) * Math.PI * 2;
        points.push(
          new THREE.Vector3(Math.cos(angle) * STAGE_RADIUS * fraction, 0, Math.sin(angle) * STAGE_RADIUS * fraction)
        );
      }
      const ring = new THREE.LineLoop(this.track(new THREE.BufferGeometry().setFromPoints(points)), ringMaterial);
      ring.position.y = floorY + 0.001;
      group.add(ring);
    }
    return group;
  }

  dispose(): void {
    this.menu?.dispose();
    this.title.dispose();
    this.toolbar.dispose();
    for (const resource of this.owned.splice(0)) resource.dispose();
    this.object.removeFromParent();
  }
}
