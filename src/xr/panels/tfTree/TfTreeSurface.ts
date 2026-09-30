import { layoutTfTree, type TfNodePosition } from '../../../features/tfTree/tfTreeLayout';
import { createEmptyTfTreeState, isTransformStale, type TfTreeState } from '../../../features/tfTree/tfTreeModel';
import { SpatialSurface, type SurfaceItem } from '../../ui/SpatialSurface';
import { drawText, fillRoundRect, strokeRoundRect, XR_THEME } from '../../ui/canvasKit';

/** One bounded canvas for the graph. Layout changes only when its topology changes. */
export class TfTreeSurface {
  readonly surface: SpatialSurface;
  private state = createEmptyTfTreeState();
  private positions = new Map<string, TfNodePosition>();
  private topology = '';
  private drawing = '';
  private scale = 1;
  private center = { x: 0, y: 0 };
  private focused: string | null = null;
  private selected: string | null = null;
  private highlightStale = true;
  private now = 0;
  private ready = false;

  constructor(private readonly onSelect: (frame: string) => void) {
    this.surface = new SpatialSurface({
      width: 0.86,
      height: 0.6,
      drawBackground: (ctx, w, h) => {
        fillRoundRect(ctx, 0, 0, w, h, 24, XR_THEME.surface);
        strokeRoundRect(ctx, 1, 1, w - 2, h - 2, 24, XR_THEME.surfaceBorder);
      },
    });
    this.draw();
  }

  setState(state: TfTreeState, highlightStale: boolean, now: number): void {
    this.ready = true;
    this.state = state;
    this.highlightStale = highlightStale;
    this.now = now;
    const topology = JSON.stringify([
      [...state.knownFrames].sort(),
      [...state.transformsByChild.values()].map(t => [t.parentFrame, t.childFrame]).sort(),
    ]);
    const drawing = JSON.stringify([
      topology,
      [...state.transformsByChild.values()].map(t => [
        t.childFrame,
        t.source,
        highlightStale && isTransformStale(t, now, 5000),
      ]),
    ]);
    if (drawing === this.drawing) return;
    this.drawing = drawing;
    if (topology !== this.topology) {
      this.topology = topology;
      this.positions = layoutTfTree(state);
      if (this.focused && this.positions.has(this.focused)) this.centerOn(this.focused);
      else this.fit();
    }
    if (this.selected && !state.knownFrames.has(this.selected)) this.selected = null;
    this.draw();
  }

  clear(): void {
    this.ready = false;
    this.state = createEmptyTfTreeState();
    this.positions.clear();
    this.topology = '';
    this.drawing = '';
    this.focused = this.selected = null;
    this.draw();
  }

  fit(): void {
    this.focused = null;
    const points = [...this.positions.values()];
    const width = Math.max(172, ...points.map(p => p.x + 172));
    const height = Math.max(48, ...points.map(p => p.y + 48));
    this.center = { x: width / 2, y: height / 2 };
    this.scale = Math.min(2.5, (this.surface.pixelWidth - 80) / width, (this.surface.pixelHeight - 180) / height);
    this.draw();
  }

  focus(frame: string): void {
    this.focused = this.selected = frame;
    this.scale = 2.5;
    this.centerOn(frame);
    this.draw();
  }

  private centerOn(frame: string): void {
    const point = this.positions.get(frame);
    if (point) this.center = { x: point.x + 86, y: point.y + 24 };
  }

  zoom(factor: number): void {
    this.scale = Math.max(0.02, Math.min(5, this.scale * factor));
    this.draw();
  }

  private draw(): void {
    const { pixelWidth: w, pixelHeight: h } = this.surface;
    const top = 68,
      bottom = h - 62;
    const project = (point: TfNodePosition) => ({
      x: w / 2 + (point.x - this.center.x) * this.scale,
      y: (top + bottom) / 2 + (point.y - this.center.y) * this.scale,
    });
    const color = (frame: string): string => {
      const transform = this.state.transformsByChild.get(frame);
      if (!transform) return XR_THEME.textMuted;
      if (transform.source === 'static') return XR_THEME.accent;
      return this.highlightStale && isTransformStale(transform, this.now, 5000) ? XR_THEME.danger : XR_THEME.success;
    };
    const items: SurfaceItem[] = [
      {
        id: 'graph',
        x: 0,
        y: top,
        w,
        h: bottom - top,
        draw: ctx => {
          drawText(
            ctx,
            `${this.state.knownFrames.size} frames · ${this.state.transformsByChild.size} transforms`,
            24,
            32,
            w - 48,
            { size: 28, color: XR_THEME.textMuted }
          );
          drawText(ctx, 'Dynamic · green    Static · blue    Stale · red', 24, h - 28, w - 48, {
            size: 24,
            color: XR_THEME.textMuted,
          });
          ctx.beginPath();
          ctx.rect(16, top, w - 32, bottom - top);
          ctx.clip();
          if (!this.state.knownFrames.size) {
            drawText(
              ctx,
              this.ready ? 'Waiting for TF data or matching frames' : 'Waiting for the workspace panel…',
              w / 2,
              h / 2,
              w - 80,
              { size: 30, align: 'center', color: XR_THEME.textMuted }
            );
          }
          this.state.transformsByChild.forEach(transform => {
            const parent = this.positions.get(transform.parentFrame),
              child = this.positions.get(transform.childFrame);
            if (!parent || !child) return;
            const a = project({ x: parent.x + 86, y: parent.y + 48 });
            const b = project({ x: child.x + 86, y: child.y });
            ctx.strokeStyle = color(transform.childFrame);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(a.x, (a.y + b.y) / 2);
            ctx.lineTo(b.x, (a.y + b.y) / 2);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          });
        },
      },
    ];
    this.positions.forEach((point, frame) => {
      const p = project(point),
        width = 172 * this.scale,
        height = 48 * this.scale;
      // Clip hit regions too: zoomed nodes must never intercept the toolbar or status strip.
      const x = Math.max(16, p.x),
        y = Math.max(top, p.y);
      const right = Math.min(w - 16, p.x + width),
        lower = Math.min(bottom, p.y + height);
      if (right <= x || lower <= y) return;
      items.push({
        id: `frame:${frame}`,
        x,
        y,
        w: right - x,
        h: lower - y,
        onPress: () => {
          this.selected = frame;
          this.draw();
          this.onSelect(frame);
        },
        draw: (ctx, _item, hover) => {
          ctx.beginPath();
          ctx.rect(16, top, w - 32, bottom - top);
          ctx.clip();
          fillRoundRect(
            ctx,
            p.x,
            p.y,
            width,
            height,
            Math.min(18, height / 4),
            this.selected === frame ? XR_THEME.itemActive : hover.hover ? XR_THEME.itemHover : XR_THEME.item
          );
          strokeRoundRect(ctx, p.x + 1, p.y + 1, width - 2, height - 2, Math.min(18, height / 4), color(frame), 2);
          drawText(ctx, frame, p.x + width / 2, p.y + height / 2, Math.max(1, width - 18), {
            size: Math.min(32, height * 0.4),
            align: 'center',
          });
        },
      });
    });
    this.surface.setItems(items);
  }

  dispose(): void {
    this.surface.dispose();
  }
}
