import { SpatialSurface, type SurfaceItem } from './SpatialSurface';
import { XR_THEME, drawIcon, drawText, fillRoundRect, strokeRoundRect, type IconName } from './canvasKit';

export interface ToolbarButton {
  id: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Latched look, for buttons that open something (the settings menu). */
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

const HEIGHT_METRES = 0.1;
const GAP_PX = 10;

/** A row of icon buttons on one surface. Sized once; the button set can change freely. */
export class SpatialToolbar {
  readonly surface: SpatialSurface;

  constructor(width: number) {
    this.surface = new SpatialSurface({ width, height: HEIGHT_METRES, drawBackground: drawBar });
  }

  setButtons(buttons: readonly ToolbarButton[]): void {
    const { pixelWidth, pixelHeight } = this.surface;
    const count = Math.max(buttons.length, 1);
    const buttonWidth = (pixelWidth - GAP_PX * (count + 1)) / count;
    const buttonHeight = pixelHeight - GAP_PX * 2;

    const items: SurfaceItem[] = buttons.map((button, index) => ({
      id: button.id,
      x: GAP_PX + index * (buttonWidth + GAP_PX),
      y: GAP_PX,
      w: buttonWidth,
      h: buttonHeight,
      disabled: button.disabled,
      onPress: button.onPress,
      draw: (ctx, item, state) => {
        const fill = button.disabled
          ? XR_THEME.itemDisabled
          : state.hover
            ? XR_THEME.itemHover
            : button.active
              ? XR_THEME.itemActive
              : XR_THEME.item;
        fillRoundRect(ctx, item.x, item.y, item.w, item.h, 18, fill);
        if (button.active) strokeRoundRect(ctx, item.x, item.y, item.w, item.h, 18, XR_THEME.accent, 3);
        const color = button.disabled
          ? XR_THEME.textDisabled
          : button.danger
            ? XR_THEME.danger
            : XR_THEME.text;
        drawIcon(ctx, button.icon, item.x + item.w / 2, item.y + item.h * 0.4, item.h * 0.36, color);
        drawText(ctx, button.label, item.x + item.w / 2, item.y + item.h * 0.8, item.w - 8, {
          size: 21,
          color: button.disabled ? XR_THEME.textDisabled : XR_THEME.textMuted,
          align: 'center',
        });
      },
    }));
    this.surface.setItems(items);
  }

  dispose(): void {
    this.surface.dispose();
  }
}

function drawBar(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  fillRoundRect(ctx, 0, 0, width, height, 26, XR_THEME.surface);
  strokeRoundRect(ctx, 1.5, 1.5, width - 3, height - 3, 25, XR_THEME.surfaceBorder, 3);
}
