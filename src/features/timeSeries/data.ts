export interface TimeseriesSample {
  time: number;
  value: number;
}

export interface TimeseriesRange {
  min: number;
  max: number;
}

export type FilterConfig = { type: 'raw' } | { type: 'movingAverage'; window: number } | { type: 'ema'; alpha: number };

const FIELD_SEGMENT_PATTERN = /^([^\[\]]+)(?:\[(\d+)\])?$/;

const readPathSegment = (value: unknown, segment: string): unknown => {
  const match = FIELD_SEGMENT_PATTERN.exec(segment);
  if (!match || value === null || typeof value !== 'object') return undefined;
  const next = (value as Record<string, unknown>)[match[1]];
  if (match[2] === undefined) return next;
  return Array.isArray(next) ? next[Number(match[2])] : undefined;
};

export const getNumericValueAtPath = (message: unknown, fieldPath: string): number | null => {
  const value = fieldPath.split('.').reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined;
    return readPathSegment(current, segment);
  }, message);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const parseFieldPath = (value: string): string => value.trim();

export const discoverNumericFields = (
  message: unknown,
  options: {
    maxDepth?: number;
    maxArrayItems?: number;
    maxFields?: number;
  } = {}
): string[] => {
  const maxDepth = options.maxDepth ?? 5;
  const maxArrayItems = options.maxArrayItems ?? 8;
  const maxFields = options.maxFields ?? 8;
  const fields: string[] = [];
  const ancestors = new Set<object>();

  const visit = (value: unknown, path: string, depth: number) => {
    if (fields.length >= maxFields || depth > maxDepth) return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (path) fields.push(path);
      return;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) return;
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.slice(0, maxArrayItems).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
        visit(item, path ? `${path}.${key}` : key, depth + 1);
      });
    }
    ancestors.delete(value);
  };

  visit(message, '', 0);
  return fields;
};

export const chooseAutoPlotFields = (fields: readonly string[], limit = 8): string[] => {
  const telemetryFields = fields.filter(path => !isRosTimestampField(path));
  return (telemetryFields.length ? telemetryFields : fields).slice(0, Math.max(0, limit));
};

export const isRosTimestampField = (path: string): boolean => /(^|\.)stamp\.(sec|nanosec)$/.test(path);

/** A fixed-capacity FIFO. Push and age/count eviction are amortized O(1). */
export class SampleBuffer {
  private values: Array<TimeseriesSample | undefined>;
  private start = 0;
  private length = 0;

  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.values = new Array(this.capacity);
  }

  get size(): number {
    return this.length;
  }

  clear(): void {
    this.values = new Array(this.capacity);
    this.start = 0;
    this.length = 0;
  }

  push(sample: TimeseriesSample, minimumTime = -Infinity): void {
    if (this.length < this.capacity) {
      this.values[(this.start + this.length) % this.capacity] = sample;
      this.length += 1;
    } else {
      this.values[this.start] = sample;
      this.start = (this.start + 1) % this.capacity;
    }
    while (this.length > 0) {
      const oldest = this.values[this.start];
      if (!oldest || oldest.time >= minimumTime) break;
      this.values[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.length -= 1;
    }
  }

  latest(): TimeseriesSample | undefined {
    if (this.length === 0) return undefined;
    return this.values[(this.start + this.length - 1) % this.capacity];
  }

  toArray(minimumTime = -Infinity): TimeseriesSample[] {
    const result: TimeseriesSample[] = [];
    for (let index = 0; index < this.length; index += 1) {
      const sample = this.values[(this.start + index) % this.capacity];
      if (sample && sample.time >= minimumTime) result.push(sample);
    }
    return result;
  }
}

/** Incremental filter state. Changing configuration creates a fresh processor. */
export class RealtimeFilter {
  private movingValues: number[] = [];
  private movingStart = 0;
  private movingLength = 0;
  private movingSum = 0;
  private emaValue: number | null = null;

  constructor(readonly config: FilterConfig) {
    if (config.type === 'movingAverage') {
      this.movingValues = new Array(Math.max(1, Math.floor(config.window)));
    }
  }

  next(value: number): number {
    if (this.config.type === 'raw') return value;
    if (this.config.type === 'ema') {
      this.emaValue =
        this.emaValue === null ? value : this.config.alpha * value + (1 - this.config.alpha) * this.emaValue;
      return this.emaValue;
    }

    const capacity = this.movingValues.length;
    if (this.movingLength < capacity) {
      this.movingValues[(this.movingStart + this.movingLength) % capacity] = value;
      this.movingLength += 1;
    } else {
      this.movingSum -= this.movingValues[this.movingStart] ?? 0;
      this.movingValues[this.movingStart] = value;
      this.movingStart = (this.movingStart + 1) % capacity;
    }
    this.movingSum += value;
    return this.movingSum / this.movingLength;
  }
}

export const getPlotRange = (
  samples: readonly TimeseriesSample[],
  autoScale: boolean,
  fixedMin = -1,
  fixedMax = 1
): TimeseriesRange => {
  if (!autoScale) {
    const min = Math.min(fixedMin, fixedMax);
    const max = Math.max(fixedMin, fixedMax);
    return min === max ? { min: min - 1, max: max + 1 } : { min, max };
  }
  if (samples.length === 0) return { min: -1, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  samples.forEach(({ value }) => {
    min = Math.min(min, value);
    max = Math.max(max, value);
  });
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    return { min: min - padding, max: max + padding };
  }
  const padding = (max - min) * 0.08;
  return { min: min - padding, max: max + padding };
};

/** Limits canvas work while retaining each bucket's extrema and endpoints. */
export const decimateSamples = (samples: readonly TimeseriesSample[], maxPoints: number): TimeseriesSample[] => {
  const limit = Math.max(4, Math.floor(maxPoints));
  if (samples.length <= limit) return [...samples];
  const result: TimeseriesSample[] = [samples[0]];
  const bucketCount = Math.max(1, Math.floor((limit - 2) / 2));
  const interiorLength = samples.length - 2;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = 1 + Math.floor((bucket * interiorLength) / bucketCount);
    const to = 1 + Math.floor(((bucket + 1) * interiorLength) / bucketCount);
    let min = samples[from];
    let max = samples[from];
    for (let index = from + 1; index < Math.max(from + 1, to); index += 1) {
      if (samples[index].value < min.value) min = samples[index];
      if (samples[index].value > max.value) max = samples[index];
    }
    if (min.time <= max.time) result.push(min, max);
    else result.push(max, min);
  }
  result.push(samples[samples.length - 1]);
  return result;
};

export const createCsv = (series: ReadonlyMap<string, readonly TimeseriesSample[]>): string => {
  const rows = ['timestamp_iso,elapsed_seconds,series,value'];
  const allSamples = [...series.values()].flatMap(samples => samples);
  const firstTime = allSamples.length
    ? allSamples.reduce((min, sample) => Math.min(min, sample.time), Infinity)
    : Date.now();
  [...series.entries()]
    .flatMap(([name, samples]) => samples.map(sample => ({ name, ...sample })))
    .sort((left, right) => left.time - right.time)
    .forEach(sample => {
      const escapedName = `"${sample.name.replace(/"/g, '""')}"`;
      rows.push(
        `${new Date(sample.time).toISOString()},${((sample.time - firstTime) / 1000).toFixed(6)},${escapedName},${sample.value}`
      );
    });
  return `${rows.join('\n')}\n`;
};
