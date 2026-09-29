import { displayName, type TimeseriesConfig } from '../../../features/timeSeries/config';
import type { TimeseriesSample } from '../../../features/timeSeries/data';
import { drawPlotContent, liveView, zoomView, type PlotView } from '../../../features/timeSeries/plot';
import { getTimeSeriesPresentation, type TimeSeriesPresentation } from '../../../features/timeSeries/presentation';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { SpatialSurface, type SurfaceItem } from '../../ui/SpatialSurface';
import { drawText, fillRoundRect, strokeRoundRect, XR_THEME } from '../../ui/canvasKit';
import type { XrPanelRenderer } from '../registry';
import { XrTimeSeriesSettings } from './XrTimeSeriesSettings';

export const timeSeriesPanelRenderer: XrPanelRenderer = {
  panelType: 'timeSeries',
  create(ctx) {
    const frame = new PanelFrame({
      panelId: ctx.panelId,
      title: ctx.title,
      isPassthrough: ctx.isPassthrough,
      layout: 'surface',
      onClose: ctx.requestClose,
      onPlacementChange: ctx.savePlacement,
    });
    let presentation: TimeSeriesPresentation | null = null;
    let settings: XrTimeSeriesSettings | null = null;
    let disposed = false;
    let active = true;
    let lastRevision = -1;
    let discoveredCount = -1;
    let lastDraw = -Infinity;
    let config: TimeseriesConfig | null = null;
    let chromeKey = '';
    let legendPage = 0;
    let data = new Map<string, TimeseriesSample[]>();
    let held: Map<string, TimeseriesSample[]> | null = null;
    let view: PlotView | null = null;
    const menu = new SpatialMenu({ onClose: () => syncToolbar() });
    frame.attachMenu(menu);

    const surface = new SpatialSurface({
      width: 0.86,
      height: frame.stageHeight,
      drawBackground: (canvas, w, h) => {
        fillRoundRect(canvas, 0, 0, w, h, 24, XR_THEME.surface);
        strokeRoundRect(canvas, 1, 1, w - 2, h - 2, 24, XR_THEME.surfaceBorder);
      },
    });
    surface.mesh.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(surface.mesh);

    function resetView() {
      held = null;
      view = null;
      lastRevision = -1;
    }

    function zoom(factor: number) {
      if (!presentation) return;
      held ??= presentation.engine.snapshot();
      view = zoomView(view ?? liveView(held, presentation.engine.config), factor);
      lastRevision = -1;
      syncToolbar();
    }

    function syncToolbar() {
      const engine = presentation?.engine;
      frame.setToolbar([
        {
          id: 'settings',
          icon: 'gear',
          label: 'Signals',
          active: menu.isOpen,
          disabled: !settings,
          onPress: () => {
            if (menu.isOpen) menu.close();
            else settings?.open();
            syncToolbar();
          },
        },
        {
          id: 'pause',
          icon: engine?.paused ? 'play' : 'pause',
          label: engine?.paused ? 'Resume' : 'Pause',
          active: engine?.paused,
          disabled: !engine,
          onPress: () => {
            if (engine) engine.paused = !engine.paused;
            lastRevision = -1;
            syncToolbar();
          },
        },
        {
          id: 'live',
          icon: 'reset',
          label: 'Live',
          active: !view,
          disabled: !engine,
          onPress: () => {
            resetView();
            syncToolbar();
          },
        },
        { id: 'zoom-out', icon: 'minus', label: 'Zoom out', disabled: !engine, onPress: () => zoom(1.5) },
        { id: 'zoom-in', icon: 'plus', label: 'Zoom in', disabled: !engine, onPress: () => zoom(1 / 1.5) },
      ]);
    }

    function draw() {
      const p = presentation;
      const c = p?.engine.config;
      const w = surface.pixelWidth;
      const h = surface.pixelHeight;
      const items: SurfaceItem[] = [];
      const status = !p
        ? 'Waiting for the workspace panel…'
        : p.error ||
          (!p.connected ? 'Disconnected' : p.engine.paused ? 'Paused' : view ? 'Inspecting · Live to follow' : 'Live');
      items.push({
        id: 'status',
        x: 24,
        y: 0,
        w: w - 48,
        h: 62,
        draw: canvas => {
          drawText(canvas, status, 24, 30, w - 48, {
            size: 27,
            color: p?.error ? XR_THEME.danger : XR_THEME.textMuted,
          });
        },
      });
      if (!p || !c) {
        surface.setItems(items);
        return;
      }
      const shown = held ?? data;
      const plotHeight = h - 305;
      items.push({
        id: 'plot',
        x: 0,
        y: 64,
        w,
        h: plotHeight,
        onPress: c.series.length
          ? undefined
          : () => {
              settings?.open();
              syncToolbar();
            },
        draw: canvas => {
          if (!c.series.length) {
            drawText(canvas, 'Add a ROS topic to start plotting', w / 2, 64 + plotHeight / 2, w - 80, {
              size: 34,
              color: XR_THEME.textMuted,
              align: 'center',
            });
            return;
          }
          // Logical pixels keep the same plot geometry and labels as desktop at headset legibility.
          canvas.translate(0, 64);
          canvas.scale(2.5, 2.5);
          drawPlotContent(canvas, w / 2.5, plotHeight / 2.5, shown, c, view ?? liveView(shown, c), {
            text: XR_THEME.textMuted,
            grid: XR_THEME.surfaceBorder,
          });
        },
      });
      const pages = Math.max(1, Math.ceil(c.series.length / 4));
      legendPage = Math.min(legendPage, pages - 1);
      c.series.slice(legendPage * 4, legendPage * 4 + 4).forEach((s, index) => {
        const x = 20 + (index % 2) * (w / 2);
        const y = h - 222 + Math.floor(index / 2) * 78;
        const samples = shown.get(s.id);
        const last = samples?.[samples.length - 1];
        const value =
          p.engine.errors.get(s.id) ?? (last ? `${Number(last.value.toPrecision(6))} ${s.unit}` : 'Waiting for data');
        items.push({
          id: `signal-${s.id}`,
          x,
          y,
          w: w / 2 - 40,
          h: 70,
          onPress: () =>
            p.configure({
              ...p.engine.config,
              series: p.engine.config.series.map(item =>
                item.id === s.id ? { ...item, enabled: !item.enabled } : item
              ),
            }),
          draw: (canvas, item, state) => {
            fillRoundRect(canvas, item.x, item.y, item.w, item.h, 12, state.hover ? XR_THEME.itemHover : XR_THEME.item);
            fillRoundRect(canvas, x + 12, y + 15, 6, 40, 3, s.enabled ? s.color : XR_THEME.textDisabled);
            drawText(canvas, displayName(s), x + 32, y + 22, item.w - 44, {
              size: 25,
              color: s.enabled ? XR_THEME.text : XR_THEME.textDisabled,
            });
            drawText(canvas, s.enabled ? value : 'Hidden', x + 32, y + 51, item.w - 44, {
              size: 24,
              color: XR_THEME.textMuted,
            });
          },
        });
      });
      if (pages > 1) {
        for (const [id, label, direction, x] of [
          ['legend-prev', 'Previous', -1, 20],
          ['legend-next', 'Next', 1, w - 200],
        ] as const) {
          items.push({
            id,
            x,
            y: h - 60,
            w: 180,
            h: 48,
            disabled: direction < 0 ? legendPage === 0 : legendPage === pages - 1,
            onPress: () => {
              legendPage += direction;
              draw();
            },
            draw: (canvas, item, state) => {
              fillRoundRect(
                canvas,
                item.x,
                item.y,
                item.w,
                item.h,
                12,
                state.hover ? XR_THEME.itemHover : XR_THEME.item
              );
              drawText(canvas, label, item.x + item.w / 2, item.y + item.h / 2, item.w - 20, {
                size: 26,
                align: 'center',
                color: item.disabled ? XR_THEME.textDisabled : XR_THEME.text,
              });
            },
          });
        }
      }
      surface.setItems(items);
    }

    syncToolbar();
    draw();
    return {
      object: frame.object,
      setActive(value) {
        active = value;
        presentation?.setPresented(value);
      },
      update({ time }) {
        if (disposed || !active) return;
        // A replay switch remounts the desktop tile. Follow it without rebuilding the spatial frame.
        const next = getTimeSeriesPresentation(ctx.panelId, ctx.storageScope);
        if (next !== presentation) {
          presentation?.setPresented(false);
          settings?.dispose();
          menu.close();
          presentation = next;
          presentation?.setPresented(true);
          settings = next
            ? new XrTimeSeriesSettings(menu, next, () => {
                next.engine.clear();
                resetView();
              })
            : null;
          config = null;
          discoveredCount = -1;
          chromeKey = '';
          data = new Map();
          resetView();
          syncToolbar();
          draw();
        }
        if (!presentation) return;
        const engine = presentation.engine;
        if (config !== engine.config) {
          config = engine.config;
          resetView();
          menu.refresh();
        }
        if (discoveredCount !== engine.discovered.size) {
          discoveredCount = engine.discovered.size;
          menu.refresh();
        }
        const nextChrome = JSON.stringify([presentation.connected, presentation.error, engine.paused, Boolean(view)]);
        if (nextChrome !== chromeKey) {
          chromeKey = nextChrome;
          lastRevision = -1;
          syncToolbar();
        }
        if (time - lastDraw < 1000 / engine.config.renderFps || lastRevision === engine.revision) return;
        data = engine.snapshot();
        lastRevision = engine.revision;
        lastDraw = time;
        draw();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        presentation?.setPresented(false);
        settings?.dispose();
        surface.dispose();
        frame.dispose();
      },
    };
  },
};
