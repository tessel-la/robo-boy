import { decimateSamples, getPlotRange, type TimeseriesSample } from './data';
import type { TimeseriesConfig } from './config';
export interface PlotView {
  start: number;
  end: number;
  min: number;
  max: number;
}
export interface Point {
  x: number;
  y: number;
}
export const plotBounds = (width: number, height: number) => ({
  left: 55,
  top: 16,
  width: Math.max(1, width - 69),
  height: Math.max(1, height - 46),
});
export const pointToValue = (point: Point, view: PlotView, width: number, height: number) => {
  const b = plotBounds(width, height);
  const x = Math.max(0, Math.min(1, (point.x - b.left) / b.width));
  const y = Math.max(0, Math.min(1, (point.y - b.top) / b.height));
  return { time: view.start + x * (view.end - view.start), value: view.max - y * (view.max - view.min) };
};
export const selectionView = (a: Point, b: Point, view: PlotView, width: number, height: number): PlotView | null => {
  if (Math.abs(a.x - b.x) < 6 || Math.abs(a.y - b.y) < 6) return null;
  const p = pointToValue(a, view, width, height),
    q = pointToValue(b, view, width, height);
  const next = {
    start: Math.min(p.time, q.time),
    end: Math.max(p.time, q.time),
    min: Math.min(p.value, q.value),
    max: Math.max(p.value, q.value),
  };
  return next.end - next.start >= 1 && next.max > next.min ? next : null;
};
export const zoomView = (view: PlotView, factor: number, x = 0.5, y = 0.5): PlotView => {
  const span = Math.min(600_000, Math.max(1, (view.end - view.start) * factor));
  const range = Math.min(1e15, Math.max(1e-12, (view.max - view.min) * factor));
  const anchorX = view.start + x * (view.end - view.start),
    anchorY = view.min + y * (view.max - view.min);
  return {
    start: anchorX - x * span,
    end: anchorX + (1 - x) * span,
    min: anchorY - y * range,
    max: anchorY + (1 - y) * range,
  };
};
export const liveView = (data: Map<string, TimeseriesSample[]>, config: TimeseriesConfig): PlotView => {
  let end = 0;
  for (const s of config.series)
    if (s.enabled) {
      const samples = data.get(s.id);
      end = Math.max(end, samples?.[samples.length - 1]?.time ?? 0);
    }
  const start = end - config.timeWindowSec * 1000;
  const samples = config.series
    .filter(s => s.enabled)
    .flatMap(s => (data.get(s.id) ?? []).filter(p => p.time >= start));
  return { start, end, ...getPlotRange(samples, config.autoScale, config.minY, config.maxY) };
};
export const nearestSample = (samples: TimeseriesSample[], time: number) => {
  let low = 0,
    high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const a = samples[low - 1],
    b = samples[low];
  return !a ? b : !b ? a : time - a.time <= b.time - time ? a : b;
};

export function drawPlot(
  canvas: HTMLCanvasElement,
  data: Map<string, TimeseriesSample[]>,
  config: TimeseriesConfig,
  view: PlotView,
  cursor: Point | null,
  selection: [Point, Point] | null
) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const b = plotBounds(width, height),
    theme = getComputedStyle(canvas);
  const text = theme.getPropertyValue('--text-color-secondary').trim() || theme.color;
  const grid = theme.getPropertyValue('--border-color').trim() || '#88888844';
  const x = (time: number) => b.left + ((time - view.start) / (view.end - view.start)) * b.width;
  const y = (value: number) => b.top + ((view.max - value) / (view.max - view.min)) * b.height;
  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const fraction = i / 4,
      py = b.top + fraction * b.height,
      px = b.left + fraction * b.width;
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(b.left, py);
    ctx.lineTo(b.left + b.width, py);
    ctx.moveTo(px, b.top);
    ctx.lineTo(px, b.top + b.height);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.fillText(Number((view.max - fraction * (view.max - view.min)).toPrecision(4)).toString(), b.left - 6, py);
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    // Leave room for readable time labels on narrow phone plots.
    if (width < 360 && i % 2 !== 0) continue;
    ctx.fillText(
      `${((view.start + fraction * (view.end - view.start) - view.end) / 1000).toFixed(2)}s`,
      px,
      height - 12
    );
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.width, b.height);
  ctx.clip();
  for (const s of config.series) {
    if (!s.enabled) continue;
    const samples = decimateSamples(
      (data.get(s.id) ?? []).filter(p => p.time >= view.start && p.time <= view.end),
      Math.max(80, b.width * 2)
    );
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    samples.forEach((sample, i) => {
      if (i === 0) ctx.moveTo(x(sample.time), y(sample.value));
      else ctx.lineTo(x(sample.time), y(sample.value));
    });
    ctx.stroke();
    if (config.showPoints || samples.length === 1)
      for (const p of samples) {
        ctx.beginPath();
        ctx.arc(x(p.time), y(p.value), 2, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  if (cursor) {
    ctx.strokeStyle = text;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cursor.x, b.top);
    ctx.lineTo(cursor.x, b.top + b.height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selection) {
    const [a, z] = selection;
    ctx.fillStyle = '#579cff33';
    ctx.strokeStyle = text;
    ctx.fillRect(a.x, a.y, z.x - a.x, z.y - a.y);
    ctx.strokeRect(a.x, a.y, z.x - a.x, z.y - a.y);
  }
  ctx.restore();
}
