import {
  FiPause,
  FiPlay,
  FiRotateCcw,
  FiMove,
  FiMoreHorizontal,
  FiZoomIn,
  FiZoomOut,
  FiDownload,
  FiTrash2,
  FiPlus,
} from 'react-icons/fi';
import { useEffect, useId, useRef, useState } from 'react';
import type { TimeSeriesEngine } from './engine';
import { displayName, type TimeseriesConfig } from './config';
import TimeSeriesLegend from './TimeSeriesLegend';
import { createCsv, type TimeseriesSample } from './data';
import {
  drawPlot,
  liveView,
  nearestSample,
  plotBounds,
  pointToValue,
  selectionView,
  zoomView,
  type PlotView,
  type Point,
} from './plot';

interface Props {
  engine: TimeSeriesEngine;
  config: TimeseriesConfig;
  active: boolean;
  onToggle: (id: string) => void;
  onOpenSettings: () => void;
}
export default function TimeSeriesPlot({ engine, config, active, onToggle, onOpenSettings }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreId = useId();
  const closeMore = () => {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  };
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMore();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLOutputElement>(null);
  const rangeReadout = useRef<HTMLOutputElement>(null);
  const view = useRef<PlotView | null>(null);
  const snapshot = useRef<Map<string, TimeseriesSample[]> | null>(null);
  const cursor = useRef<Point | null>(null);
  const selection = useRef<[Point, Point] | null>(null);
  const panRef = useRef(false);
  const redraw = useRef(() => {});
  const [inspecting, setInspecting] = useState(false);
  const [pan, setPan] = useState(false);
  const [paused, setPaused] = useState(false);
  const [legend, setLegend] = useState<{ count: number; values: Record<string, string> }>({ count: 0, values: {} });
  const reset = () => {
    view.current = null;
    snapshot.current = null;
    selection.current = null;
    setInspecting(false);
    redraw.current();
  };
  const hold = () => {
    if (!snapshot.current) snapshot.current = engine.snapshot();
    if (!view.current) view.current = liveView(snapshot.current, engine.config);
    setInspecting(true);
    return view.current;
  };
  const zoom = (factor: number) => {
    view.current = zoomView(hold(), factor);
    redraw.current();
  };

  const processingKey = JSON.stringify([
    config.sampleLimit,
    config.series.map(s => [s.id, s.topic, s.messageType, s.fieldPath, s.filter, s.math]),
  ]);
  useEffect(() => {
    view.current = null;
    snapshot.current = null;
    selection.current = null;
    setInspecting(false);
  }, [processingKey]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current!;
    let lastFrame = -Infinity,
      lastLegend = -Infinity,
      frame = 0;
    let data = engine.snapshot();
    let lastRevision = -1;
    let drag: { point: Point; view: PlotView; pan: boolean } | null = null;
    let pinch: { distance: number; view: PlotView } | null = null;
    const pointers = new Map<number, Point>();
    const draw = () => {
      if (lastRevision !== engine.revision) {
        data = engine.snapshot();
        lastRevision = engine.revision;
      }
      const shown = snapshot.current ?? data,
        currentView = view.current ?? liveView(shown, engine.config);
      drawPlot(canvas, shown, engine.config, currentView, cursor.current, selection.current);
      if (rangeReadout.current) {
        const v = currentView;
        const text = `Window ${((v.end - v.start) / 1000).toFixed(2)}s · Y ${Number(v.min.toPrecision(4))} to ${Number(v.max.toPrecision(4))}`;
        if (rangeReadout.current.textContent !== text) rangeReadout.current.textContent = text;
      }
    };
    redraw.current = draw;
    const tick = (time: number) => {
      if (time - lastFrame >= 1000 / engine.config.renderFps) {
        draw();
        lastFrame = time;
      }
      if (time - lastLegend >= 250) {
        const shown = snapshot.current ?? data,
          values: Record<string, string> = {};
        const v = view.current ?? liveView(shown, engine.config),
          bounds = canvas.getBoundingClientRect();
        const cursorTime = cursor.current ? pointToValue(cursor.current, v, bounds.width, bounds.height).time : null;
        let count = 0;
        for (const s of engine.config.series) {
          const samples = shown.get(s.id) ?? [];
          count += samples.length;
          const p = cursorTime === null ? samples[samples.length - 1] : nearestSample(samples, cursorTime);
          values[s.id] = engine.errors.get(s.id) ?? (p ? `${Number(p.value.toPrecision(6))} ${s.unit}` : '—');
        }
        setLegend({ count, values });
        // Pause can also be changed by the assistant, straight on the engine.
        setPaused(engine.paused);
        if (readout.current)
          readout.current.textContent =
            cursorTime === null
              ? 'Legend shows latest values'
              : `Cursor: ${new Date(cursorTime).toLocaleTimeString()} · legend shows nearest samples`;
        lastLegend = time;
      }
      frame = requestAnimationFrame(tick);
    };
    const point = (event: PointerEvent | WheelEvent): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    };
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      const p = point(event),
        r = canvas.getBoundingClientRect(),
        b = plotBounds(r.width, r.height);
      if (p.x < b.left || p.x > b.left + b.width || p.y < b.top || p.y > b.top + b.height) return;
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, p);
      const v = { ...hold() };
      if (pointers.size === 2) {
        pinch = { distance: Math.max(1, distance()), view: v };
        drag = null;
        selection.current = null;
      } else if (pointers.size === 1)
        drag = { point: p, view: v, pan: panRef.current || event.ctrlKey || event.button === 1 };
    };
    const move = (event: PointerEvent) => {
      const p = point(event);
      cursor.current = p;
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, p);
      if (pinch && pointers.size >= 2) view.current = zoomView(pinch.view, pinch.distance / Math.max(1, distance()));
      else if (drag) {
        if (drag.pan) {
          const r = canvas.getBoundingClientRect(),
            b = plotBounds(r.width, r.height);
          const dx = ((p.x - drag.point.x) / b.width) * (drag.view.end - drag.view.start),
            dy = ((p.y - drag.point.y) / b.height) * (drag.view.max - drag.view.min);
          view.current = {
            start: drag.view.start - dx,
            end: drag.view.end - dx,
            min: drag.view.min + dy,
            max: drag.view.max + dy,
          };
        } else selection.current = [drag.point, p];
      }
    };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      if (drag && !drag.pan && event.type === 'pointerup') {
        const r = canvas.getBoundingClientRect();
        view.current = selectionView(drag.point, point(event), drag.view, r.width, r.height) ?? view.current;
      }
      pointers.delete(event.pointerId);
      drag = null;
      pinch = null;
      selection.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      draw();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = point(event),
        r = canvas.getBoundingClientRect(),
        b = plotBounds(r.width, r.height);
      view.current = zoomView(
        hold(),
        event.deltaY > 0 ? 1.2 : 1 / 1.2,
        Math.max(0, Math.min(1, (p.x - b.left) / b.width)),
        Math.max(0, Math.min(1, 1 - (p.y - b.top) / b.height))
      );
      draw();
    };
    const leave = () => {
      if (!pointers.size) cursor.current = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      redraw.current = () => {};
      selection.current = null;
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
    };
    // The engine has stable identity; streaming state and configuration are read at frame time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, active]);

  const exportCsv = () => {
    const data = snapshot.current ?? engine.snapshot();
    const csv = createCsv(
      new Map(
        config.series.map(s => [
          `${displayName(s)} [${s.unit}] · ${s.topic}:${s.fieldPath} · ${s.id}`,
          data.get(s.id) ?? [],
        ])
      )
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `roboboy-timeseries-${Date.now()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <>
      <div className="timeseries-toolbar" aria-label="Plot controls">
        <button
          className={`timeseries-icon-button${paused ? ' timeseries-accent' : ''}`}
          aria-label={paused ? 'Resume' : 'Pause'}
          title={paused ? 'Resume capture' : 'Pause capture'}
          onClick={() => {
            engine.paused = !engine.paused;
            setPaused(engine.paused);
          }}
        >
          {paused ? <FiPlay aria-hidden="true" /> : <FiPause aria-hidden="true" />}
        </button>
        <button
          className={`timeseries-icon-button${inspecting ? ' timeseries-accent' : ''}`}
          onClick={() => {
            engine.paused = false;
            setPaused(false);
            reset();
          }}
          aria-label="Reset / Live"
          title="Reset zoom and resume live capture"
        >
          <FiRotateCcw aria-hidden="true" />
        </button>
        <div className="timeseries-more" ref={moreRef}>
          <button
            className="timeseries-icon-button"
            aria-label="More"
            title="More plot controls"
            ref={moreButtonRef}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <FiMoreHorizontal aria-hidden="true" />
          </button>
          {moreOpen && (
            <div id={moreId} className="timeseries-more-actions" role="group" aria-label="More plot controls">
              <div className="timeseries-interaction-hint" role="status">
                {paused
                  ? 'Paused · tap Resume to capture'
                  : inspecting
                    ? 'Inspecting · tap Live to follow'
                    : pan
                      ? 'Drag to pan · pinch to zoom'
                      : 'Drag to select · pinch to zoom'}
              </div>
              <button
                onClick={() => {
                  zoom(1 / 1.5);
                  closeMore();
                }}
              >
                <FiZoomIn aria-hidden="true" />
                Zoom in
              </button>
              <button
                onClick={() => {
                  zoom(1.5);
                  closeMore();
                }}
              >
                <FiZoomOut aria-hidden="true" />
                Zoom out
              </button>
              <button
                aria-pressed={pan}
                onClick={() => {
                  panRef.current = !pan;
                  setPan(!pan);
                  closeMore();
                }}
              >
                <FiMove aria-hidden="true" />
                <span>Pan</span>
              </button>
              <button
                onClick={() => {
                  exportCsv();
                  closeMore();
                }}
                disabled={!legend.count}
              >
                <FiDownload aria-hidden="true" />
                Export CSV
              </button>
              <button
                className="timeseries-danger"
                onClick={() => {
                  engine.clear();
                  reset();
                  closeMore();
                }}
              >
                <FiTrash2 aria-hidden="true" />
                Clear data
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="timeseries-plot">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label="Time series plot. Drag to zoom; pinch or scroll to zoom; use Pan to move. Plus, minus, and Escape control zoom."
          onDoubleClick={reset}
          onKeyDown={event => {
            if (event.key === 'Escape' || event.key === 'Home') {
              event.preventDefault();
              reset();
            }
            if (event.key === '+' || event.key === '=') {
              event.preventDefault();
              zoom(1 / 1.5);
            }
            if (event.key === '-') {
              event.preventDefault();
              zoom(1.5);
            }
          }}
        />
        {(!legend.count || config.series.every(s => !s.enabled)) && (
          <div className="timeseries-empty">
            {!config.series.length ? (
              <>
                <span>Plot your robot’s signals</span>
                <button className="timeseries-accent" onClick={onOpenSettings}>
                  <FiPlus aria-hidden="true" />
                  Add signals
                </button>
              </>
            ) : config.series.every(s => !s.enabled) ? (
              'All signals are hidden. Use the legend or Settings to show one.'
            ) : (
              'Waiting for numeric ROS messages…'
            )}
          </div>
        )}
      </div>
      <TimeSeriesLegend series={config.series} values={legend.values} onToggle={onToggle} />
      <div className="timeseries-footer">
        <output aria-label="Visible plot range" ref={rangeReadout} />
        <output className="timeseries-cursor-readout" ref={readout}>
          Legend shows latest values
        </output>
        <span>{legend.count.toLocaleString()} samples</span>
      </div>
    </>
  );
}
