import type { TimeseriesConfig } from './config';
import type { TimeseriesSample } from './data';

export interface XYPoint extends TimeseriesSample {
  /** The original Y sample time; `time` is the plotted X coordinate. */
  sourceTime: number;
  breakBefore: boolean;
}

/** Linear merge in message-arrival order. Equal wall-clock timestamps do not identify a message. */
export function xyData(data: ReadonlyMap<string, readonly TimeseriesSample[]>, config: TimeseriesConfig) {
  const x = data.get(config.xSeriesId) ?? [];
  const result = new Map<string, XYPoint[]>();
  for (const series of config.series) {
    if (!series.enabled || series.id === config.xSeriesId) continue;
    const points: XYPoint[] = [];
    let index = 0,
      gap = true;
    for (const y of data.get(series.id) ?? []) {
      if (y.event === undefined) {
        gap = true;
        continue;
      }
      while (index < x.length && (x[index].event ?? Infinity) <= y.event) index++;
      const sample = x[index - 1];
      if (!sample || sample.epoch !== y.epoch || !Number.isFinite(sample.value) || !Number.isFinite(y.value)) {
        gap = true;
        continue;
      }
      const matches =
        config.xyPairing === 'message'
          ? sample.event === y.event
          : sample.time <= y.time && y.time - sample.time <= config.xyToleranceMs;
      if (matches) {
        points.push({
          time: sample.value,
          value: y.value,
          sourceTime: y.time,
          event: y.event,
          epoch: y.epoch,
          breakBefore: gap || (points.length > 0 && points[points.length - 1].epoch !== y.epoch),
        });
        gap = false;
      } else gap = true;
    }
    result.set(series.id, points);
  }
  return result;
}

/** Sample-weighted statistics on captured, processed values; no interpolation or decimation. */
export function intervalStatistics(samples: readonly TimeseriesSample[], start: number, end: number) {
  let count = 0,
    min = Infinity,
    max = -Infinity,
    mean = 0,
    m2 = 0,
    scale = 0,
    squares = 0;
  let first: number | undefined, last: number | undefined;
  for (const sample of samples) {
    const value = sample.value;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      sample.time < start ||
      sample.time > end ||
      !Number.isFinite(value) ||
      !Number.isFinite(sample.time)
    )
      continue;
    count++;
    first ??= value;
    last = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    const previousMean = mean;
    mean = mean * ((count - 1) / count) + value / count;
    m2 += (value - previousMean) * (value - mean);
    const magnitude = Math.abs(value);
    if (magnitude > scale) {
      squares = squares * (scale / magnitude) ** 2 + 1;
      scale = magnitude;
    } else if (scale) squares += (magnitude / scale) ** 2;
  }
  const finite = (value: number) => (Number.isFinite(value) ? value : null);
  return {
    count,
    min: count ? min : null,
    max: count ? max : null,
    mean: count ? finite(mean) : null,
    rms: count ? finite(scale * Math.sqrt(squares / count)) : null,
    std: count ? finite(Math.sqrt(Math.max(0, m2 / count))) : null,
    delta: count ? finite(last! - first!) : null,
  };
}

export function xyCsv(data: ReadonlyMap<string, readonly XYPoint[]>, config: TimeseriesConfig) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = ['series,time_ms,x,y'];
  for (const series of config.series)
    for (const point of data.get(series.id) ?? [])
      rows.push(`${quote(series.label || series.id)},${point.sourceTime},${point.time},${point.value}`);
  return rows.join('\n');
}

/** Bound canvas work without sorting by X (a trajectory can double back), carrying gaps through skipped points. */
export function decimateXY(samples: readonly (TimeseriesSample & { breakBefore?: boolean })[], maxPoints: number) {
  const limit = Math.max(2, Math.floor(maxPoints));
  const stride = Math.max(1, Math.ceil((samples.length - 1) / (limit - 1)));
  const result: (TimeseriesSample & { breakBefore?: boolean })[] = [];
  let gap = false;
  samples.forEach((sample, index) => {
    gap ||= sample.breakBefore === true;
    if (index % stride === 0 || index === samples.length - 1) {
      result.push(gap ? { ...sample, breakBefore: true } : sample);
      gap = false;
    }
  });
  return result;
}
