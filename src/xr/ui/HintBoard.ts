import * as THREE from 'three';
import { XR_THEME, drawText, fillRoundRect, strokeRoundRect } from './canvasKit';
import { SpatialSurface } from './SpatialSurface';

const WIDTH = 0.7;
const HEIGHT = 0.26;
const DENSITY = 1400;

/** A non-interactive floating note, for telling the user what to do when the room is empty. */
export class HintBoard {
  readonly object = new THREE.Group();
  private readonly surface: SpatialSurface;

  constructor(title: string, body: string) {
    this.surface = new SpatialSurface({
      width: WIDTH,
      height: HEIGHT,
      pixelsPerMetre: DENSITY,
      drawBackground: (ctx, w, h) => {
        fillRoundRect(ctx, 0, 0, w, h, 34, XR_THEME.surface);
        strokeRoundRect(ctx, 1.5, 1.5, w - 3, h - 3, 33, XR_THEME.surfaceBorder, 3);
        drawText(ctx, title, w / 2, h * 0.36, w - 80, { size: 46, weight: 700, align: 'center' });
        drawText(ctx, body, w / 2, h * 0.68, w - 80, {
          size: 30,
          color: XR_THEME.textMuted,
          align: 'center',
        });
      },
    });
    // Purely informational: a ray should pass through it to whatever is behind.
    this.object.userData.xrPickable = false;
    this.object.add(this.surface.mesh);
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  dispose(): void {
    this.surface.dispose();
    this.object.removeFromParent();
  }
}
