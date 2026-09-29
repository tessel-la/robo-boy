import * as THREE from 'three';
import { SpatialSurface, type SurfaceItem } from './SpatialSurface';
import {
  XR_THEME,
  drawIcon,
  drawText,
  fillRoundRect,
  strokeRoundRect,
  type IconName,
} from './canvasKit';

export type MenuRow =
  | { kind: 'header'; label: string }
  | { kind: 'value'; label: string; value: string }
  | {
      kind: 'button';
      label: string;
      detail?: string;
      onPress: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Drawn at the right edge. `secondary` adds an independent second target beside it. */
      trailing?: 'chevron' | 'check';
      secondary?: { icon: IconName; onPress: () => void; danger?: boolean };
    }
  | { kind: 'toggle'; label: string; value: boolean; onChange: (value: boolean) => void }
  | {
      kind: 'stepper';
      label: string;
      value: string;
      onDecrement: () => void;
      onIncrement: () => void;
      canDecrement?: boolean;
      canIncrement?: boolean;
    };

export interface MenuTab {
  id: string;
  label: string;
  active: boolean;
  onPress: () => void;
}

export interface MenuPage {
  title: string;
  rows: MenuRow[];
  tabs?: MenuTab[];
  emptyText?: string;
}

/** Pages are factories so every refresh reads current state instead of a stale snapshot. */
export type MenuPageFactory = () => MenuPage;

export interface SpatialMenuOptions {
  /** Metres. */
  width?: number;
  /** Rows per page; the surface is sized for exactly this many so it never changes shape. */
  pageSize?: number;
  /** Reserve a tab strip under the header. */
  tabs?: boolean;
  onClose?: () => void;
}

const DENSITY = 1400;
const PAD = 16;
const HEADER_H = 84;
const TABS_H = 64;
const ROW_H = 80;
const ROW_GAP = 8;
const FOOTER_H = 64;
const SECTION_GAP = 10;
const SMALL_BUTTON = 64;

/**
 * A paged, stack-navigated list menu on a single spatial surface.
 *
 * Settings, layer editing, topic pickers and the wrist panel catalogue are all this component with
 * different pages. Navigation is push/pop with a back button, because a menu that fits a fixed
 * physical size has to hide depth behind pages rather than grow.
 */
export class SpatialMenu {
  readonly object = new THREE.Group();
  readonly surface: SpatialSurface;

  private readonly options: SpatialMenuOptions;
  private readonly pageSize: number;
  private stack: Array<{ factory: MenuPageFactory; pageIndex: number }> = [];

  constructor(options: SpatialMenuOptions = {}) {
    this.options = options;
    this.pageSize = options.pageSize ?? 6;
    const width = options.width ?? 0.56;
    const heightPx =
      PAD * 2 +
      HEADER_H +
      SECTION_GAP +
      (options.tabs ? TABS_H + SECTION_GAP : 0) +
      this.pageSize * (ROW_H + ROW_GAP) +
      FOOTER_H;

    this.surface = new SpatialSurface({
      width,
      height: heightPx / DENSITY,
      pixelsPerMetre: DENSITY,
      drawBackground: (ctx, w, h) => {
        fillRoundRect(ctx, 0, 0, w, h, 34, XR_THEME.surface);
        strokeRoundRect(ctx, 1.5, 1.5, w - 3, h - 3, 33, XR_THEME.surfaceBorder, 3);
      },
    });
    this.object.add(this.surface.mesh);
    this.object.visible = false;
  }

  get isOpen(): boolean {
    return this.object.visible;
  }

  get height(): number {
    return this.surface.height;
  }

  get width(): number {
    return this.surface.width;
  }

  open(root: MenuPageFactory): void {
    this.stack = [{ factory: root, pageIndex: 0 }];
    this.object.visible = true;
    this.refresh();
  }

  push(factory: MenuPageFactory): void {
    this.stack.push({ factory, pageIndex: 0 });
    this.refresh();
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
    this.refresh();
  }

  close(): void {
    if (!this.object.visible) return;
    this.object.visible = false;
    this.stack = [];
    this.options.onClose?.();
  }

  /** Re-read the current page factory, e.g. after the state a row displays has changed. */
  refresh(): void {
    const entry = this.stack[this.stack.length - 1];
    if (!entry) return;
    const page = entry.factory();
    const pageCount = Math.max(1, Math.ceil(page.rows.length / this.pageSize));
    entry.pageIndex = Math.min(entry.pageIndex, pageCount - 1);
    this.surface.setItems(this.layout(page, entry.pageIndex, pageCount));
  }

  private layout(page: MenuPage, pageIndex: number, pageCount: number): SurfaceItem[] {
    const { pixelWidth } = this.surface;
    const items: SurfaceItem[] = [];
    const innerWidth = pixelWidth - PAD * 2;
    let y = PAD;

    const canGoBack = this.stack.length > 1;
    items.push({
      id: 'header',
      x: PAD,
      y,
      w: innerWidth,
      h: HEADER_H,
      draw: (ctx, item) => {
        const left = PAD + (canGoBack ? HEADER_H + 12 : 8);
        drawText(ctx, page.title, left, item.y + item.h / 2, innerWidth - (left - PAD) - HEADER_H - 12, {
          size: 38,
          weight: 700,
        });
      },
    });
    if (canGoBack) {
      items.push(
        this.iconButton('back', PAD, y, HEADER_H, HEADER_H, 'chevronLeft', () => this.pop())
      );
    }
    if (this.options.onClose) {
      items.push(
        this.iconButton('close', PAD + innerWidth - HEADER_H, y, HEADER_H, HEADER_H, 'close', () =>
          this.close()
        )
      );
    }
    y += HEADER_H + SECTION_GAP;

    if (this.options.tabs) {
      const tabs = page.tabs ?? [];
      const tabWidth = tabs.length ? (innerWidth - (tabs.length - 1) * ROW_GAP) / tabs.length : 0;
      tabs.forEach((tab, index) => {
        const tabX = PAD + index * (tabWidth + ROW_GAP);
        items.push({
          id: `tab-${tab.id}`,
          x: tabX,
          y,
          w: tabWidth,
          h: TABS_H,
          onPress: tab.onPress,
          draw: (ctx, item, state) => {
            fillRoundRect(
              ctx,
              item.x,
              item.y,
              item.w,
              item.h,
              20,
              tab.active ? XR_THEME.itemActive : state.hover ? XR_THEME.itemHover : XR_THEME.item
            );
            drawText(ctx, tab.label, item.x + item.w / 2, item.y + item.h / 2, item.w - 16, {
              size: 30,
              weight: tab.active ? 700 : 500,
              align: 'center',
              color: tab.active ? XR_THEME.text : XR_THEME.textMuted,
            });
          },
        });
      });
      y += TABS_H + SECTION_GAP;
    }

    const visible = page.rows.slice(pageIndex * this.pageSize, (pageIndex + 1) * this.pageSize);
    visible.forEach((row, index) => {
      items.push(...this.rowItems(row, `row-${index}`, PAD, y + index * (ROW_H + ROW_GAP), innerWidth));
    });
    if (visible.length === 0 && page.emptyText) {
      items.push({
        id: 'empty',
        x: PAD,
        y,
        w: innerWidth,
        h: ROW_H * 2,
        draw: (ctx, item) =>
          drawText(ctx, page.emptyText ?? '', PAD + innerWidth / 2, item.y + item.h / 2, innerWidth - 32, {
            size: 30,
            color: XR_THEME.textMuted,
            align: 'center',
          }),
      });
    }
    y += this.pageSize * (ROW_H + ROW_GAP);

    if (pageCount > 1) {
      const buttonWidth = 140;
      items.push(
        this.iconButton('prev', PAD, y, buttonWidth, FOOTER_H, 'chevronLeft', () => this.turn(-1), pageIndex === 0)
      );
      items.push({
        id: 'page-label',
        x: PAD + buttonWidth,
        y,
        w: innerWidth - buttonWidth * 2,
        h: FOOTER_H,
        draw: ctx =>
          drawText(
            ctx,
            `${pageIndex + 1} / ${pageCount}`,
            PAD + innerWidth / 2,
            y + FOOTER_H / 2,
            innerWidth,
            { size: 28, color: XR_THEME.textMuted, align: 'center' }
          ),
      });
      items.push(
        this.iconButton(
          'next',
          PAD + innerWidth - buttonWidth,
          y,
          buttonWidth,
          FOOTER_H,
          'chevronRight',
          () => this.turn(1),
          pageIndex >= pageCount - 1
        )
      );
    }
    return items;
  }

  private turn(direction: number): void {
    const entry = this.stack[this.stack.length - 1];
    if (!entry) return;
    entry.pageIndex = Math.max(0, entry.pageIndex + direction);
    this.refresh();
  }

  private iconButton(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    icon: IconName,
    onPress: () => void,
    disabled = false,
    danger = false
  ): SurfaceItem {
    return {
      id,
      x,
      y,
      w,
      h,
      disabled,
      onPress,
      draw: (ctx, item, state) => {
        fillRoundRect(
          ctx,
          item.x,
          item.y,
          item.w,
          item.h,
          20,
          disabled ? XR_THEME.itemDisabled : state.hover ? XR_THEME.itemHover : XR_THEME.item
        );
        drawIcon(
          ctx,
          icon,
          item.x + item.w / 2,
          item.y + item.h / 2,
          Math.min(item.h * 0.46, 40),
          disabled ? XR_THEME.textDisabled : danger ? XR_THEME.danger : XR_THEME.text
        );
      },
    };
  }

  private rowItems(row: MenuRow, id: string, x: number, y: number, width: number): SurfaceItem[] {
    const label = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, color?: string) =>
      drawText(ctx, text, x + 24, y + ROW_H / 2, maxWidth, { size: 32, color });

    switch (row.kind) {
      case 'value':
        return [{ id, x, y, w: width, h: ROW_H, draw: ctx => {
          drawText(ctx, row.label, x + 24, y + 22, width - 48, { size: 23, color: XR_THEME.textMuted });
          drawText(ctx, row.value, x + 24, y + 55, width - 48, { size: 30 });
        } }];
      case 'header':
        return [
          {
            id,
            x,
            y,
            w: width,
            h: ROW_H,
            draw: ctx =>
              drawText(ctx, row.label.toUpperCase(), x + 12, y + ROW_H / 2 + 12, width - 24, {
                size: 24,
                weight: 700,
                color: XR_THEME.textMuted,
              }),
          },
        ];

      case 'button': {
        const secondaryWidth = row.secondary ? SMALL_BUTTON + ROW_GAP : 0;
        const mainWidth = width - secondaryWidth;
        const main: SurfaceItem = {
          id,
          x,
          y,
          w: mainWidth,
          h: ROW_H,
          disabled: row.disabled,
          onPress: row.onPress,
          draw: (ctx, item, state) => {
            fillRoundRect(
              ctx,
              item.x,
              item.y,
              item.w,
              item.h,
              20,
              row.disabled ? XR_THEME.itemDisabled : state.hover ? XR_THEME.itemHover : XR_THEME.item
            );
            const trailingWidth = row.trailing ? 44 : 0;
            const detailWidth = row.detail ? Math.min(item.w * 0.4, 260) : 0;
            const color = row.disabled
              ? XR_THEME.textDisabled
              : row.danger
                ? XR_THEME.danger
                : XR_THEME.text;
            label(ctx, row.label, item.w - 48 - trailingWidth - detailWidth, color);
            if (row.detail) {
              drawText(ctx, row.detail, item.x + item.w - 24 - trailingWidth, item.y + item.h / 2, detailWidth, {
                size: 26,
                color: XR_THEME.textMuted,
                align: 'right',
              });
            }
            if (row.trailing) {
              drawIcon(
                ctx,
                row.trailing === 'check' ? 'check' : 'chevronRight',
                item.x + item.w - 32,
                item.y + item.h / 2,
                28,
                row.trailing === 'check' ? XR_THEME.success : XR_THEME.textMuted
              );
            }
          },
        };
        if (!row.secondary) return [main];
        return [
          main,
          this.iconButton(
            `${id}:secondary`,
            x + mainWidth + ROW_GAP,
            y,
            SMALL_BUTTON,
            ROW_H,
            row.secondary.icon,
            row.secondary.onPress,
            false,
            row.secondary.danger
          ),
        ];
      }

      case 'toggle':
        return [
          {
            id,
            x,
            y,
            w: width,
            h: ROW_H,
            onPress: () => row.onChange(!row.value),
            draw: (ctx, item, state) => {
              fillRoundRect(ctx, item.x, item.y, item.w, item.h, 20, state.hover ? XR_THEME.itemHover : XR_THEME.item);
              label(ctx, row.label, item.w - 160);
              const switchW = 88;
              const switchH = 44;
              const switchX = item.x + item.w - switchW - 24;
              const switchY = item.y + (item.h - switchH) / 2;
              fillRoundRect(ctx, switchX, switchY, switchW, switchH, switchH / 2, row.value ? XR_THEME.accent : '#3a4552');
              ctx.beginPath();
              ctx.arc(row.value ? switchX + switchW - switchH / 2 : switchX + switchH / 2, switchY + switchH / 2, 17, 0, Math.PI * 2);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
            },
          },
        ];

      case 'stepper': {
        const controlWidth = 300;
        const controlX = x + width - controlWidth - 12;
        const buttonW = SMALL_BUTTON + 8;
        return [
          {
            id,
            x,
            y,
            w: width,
            h: ROW_H,
            draw: (ctx, item) => {
              fillRoundRect(ctx, item.x, item.y, item.w, item.h, 20, XR_THEME.item);
              label(ctx, row.label, controlX - x - 36);
              drawText(ctx, row.value, controlX + controlWidth / 2, item.y + item.h / 2, controlWidth - buttonW * 2 - 8, {
                size: 30,
                weight: 700,
                align: 'center',
              });
            },
          },
          this.iconButton(`${id}:dec`, controlX, y + 8, buttonW, ROW_H - 16, 'minus', row.onDecrement, row.canDecrement === false),
          this.iconButton(`${id}:inc`, controlX + controlWidth - buttonW, y + 8, buttonW, ROW_H - 16, 'plus', row.onIncrement, row.canIncrement === false),
        ];
      }
    }
  }

  dispose(): void {
    this.surface.dispose();
    this.object.removeFromParent();
    this.stack = [];
  }
}
