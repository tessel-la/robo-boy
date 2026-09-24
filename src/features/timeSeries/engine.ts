import {
  AUTO_PLOT_FIELD_LIMIT,
  COLORS,
  SERIES_LIMIT,
  createSeriesId,
  sourceKey,
  type TimeseriesConfig,
  type TimeseriesSeriesConfig,
  type TopicSource,
} from './config';
import {
  chooseAutoPlotFields,
  discoverNumericFields,
  getNumericValueAtPath,
  RealtimeFilter,
  SampleBuffer,
  type TimeseriesSample,
} from './data';
import { SignalMath } from './math';

interface Runtime {
  signature: string;
  buffer: SampleBuffer;
  filter: RealtimeFilter;
  math: SignalMath | null;
}
const signature = (s: TimeseriesSeriesConfig, config: TimeseriesConfig) => {
  const secondary = config.series.find(item => item.id === s.math.secondaryId);
  return JSON.stringify([
    s.topic,
    s.messageType,
    s.fieldPath,
    s.filter,
    s.math,
    secondary && [secondary.topic, secondary.messageType, secondary.fieldPath],
  ]);
};

/** One per tile. Incoming messages never cause a React render except field discovery. */
export class TimeSeriesEngine {
  readonly runtime = new Map<string, Runtime>();
  readonly discovered = new Map<string, string[]>();
  readonly errors = new Map<string, string>();
  readonly raw = new Map<string, TimeseriesSample>();
  paused = false;
  revision = 0;
  constructor(public config: TimeseriesConfig) {
    this.configure(config);
  }

  configure(config: TimeseriesConfig) {
    this.config = config;
    const ids = new Set(config.series.map(s => s.id));
    for (const id of this.runtime.keys())
      if (!ids.has(id)) {
        this.runtime.delete(id);
        this.raw.delete(id);
        this.errors.delete(id);
      }
    const sources = new Set(config.series.map(s => sourceKey(s.topic, s.messageType)));
    for (const key of this.discovered.keys()) if (!sources.has(key)) this.discovered.delete(key);
    for (const s of config.series) {
      const previous = this.runtime.get(s.id);
      const nextSignature = signature(s, config);
      if (previous?.signature === nextSignature && previous.buffer.capacity === config.sampleLimit) continue;
      let math: SignalMath | null = null;
      this.errors.delete(s.id);
      try {
        math = new SignalMath(s.math);
      } catch (error) {
        this.errors.set(s.id, (error as Error).message);
      }
      this.runtime.set(s.id, {
        signature: nextSignature,
        buffer: new SampleBuffer(config.sampleLimit),
        filter: new RealtimeFilter(s.filter),
        math,
      });
      this.raw.delete(s.id);
    }
    this.revision++;
  }

  clear() {
    this.runtime.clear();
    this.raw.clear();
    this.configure(this.config);
  }

  /** Reset processing across reconnections without discarding the captured history. */
  reconnect() {
    const histories = new Map([...this.runtime].map(([id, runtime]) => [id, runtime.buffer]));
    this.clear();
    this.discovered.clear();
    for (const [id, buffer] of histories) {
      const runtime = this.runtime.get(id);
      if (runtime) runtime.buffer = buffer;
    }
  }

  receive(source: TopicSource, message: unknown, now: number): TimeseriesConfig | null {
    let changed = false;
    if (!this.discovered.has(source.key)) {
      const fields = discoverNumericFields(message, { maxDepth: 8, maxArrayItems: 64, maxFields: 64 });
      this.discovered.set(source.key, fields);
      const pending = this.config.series.find(s => !s.fieldPath && sourceKey(s.topic, s.messageType) === source.key);
      if (pending) {
        const selected = chooseAutoPlotFields(
          fields,
          Math.min(AUTO_PLOT_FIELD_LIMIT, SERIES_LIMIT - this.config.series.length + 1)
        );
        if (selected.length) {
          const used = new Set(this.config.series.map(s => s.id));
          const replacements = selected.map((fieldPath, index) => {
            const id = index === 0 ? pending.id : createSeriesId(source.topic, fieldPath, used);
            used.add(id);
            return {
              ...pending,
              id,
              fieldPath,
              color:
                index === 0 ? pending.color : COLORS[(this.config.series.indexOf(pending) + index) % COLORS.length],
            };
          });
          this.configure({
            ...this.config,
            series: this.config.series.flatMap(s => (s.id === pending.id ? replacements : [s])),
          });
        }
      }
      changed = true;
    }
    const matching = this.config.series.filter(s => sourceKey(s.topic, s.messageType) === source.key && s.fieldPath);
    // Populate all raw inputs first: series ordering never changes expression results.
    for (const s of matching) {
      const value = getNumericValueAtPath(message, s.fieldPath);
      if (value !== null) this.raw.set(s.id, { time: now, value });
      else this.raw.delete(s.id);
    }
    for (const s of matching) {
      if (!s.enabled) continue;
      const runtime = this.runtime.get(s.id)!;
      const input = this.raw.get(s.id);
      if (!input || !runtime.math) continue;
      const secondary = this.raw.get(s.math.secondaryId);
      if (
        runtime.math.expression.usesY &&
        (!secondary || now - secondary.time > this.config.timeWindowSec * 1000 || secondary.time > now)
      ) {
        this.errors.set(s.id, 'Waiting for a fresh secondary signal (y).');
        continue;
      }
      const value = runtime.math.next(input.value, secondary?.value ?? 0, now);
      if (value === null) {
        if (s.math.operation !== 'derivative') this.errors.set(s.id, 'Math produced no finite value.');
        continue;
      }
      this.errors.delete(s.id);
      const filtered = runtime.filter.next(value);
      if (!Number.isFinite(filtered)) {
        this.errors.set(s.id, 'Filter produced no finite value.');
        continue;
      }
      if (!this.paused) runtime.buffer.push({ time: now, value: filtered }, now - this.config.timeWindowSec * 1000);
    }
    this.revision++;
    return changed ? this.config : null;
  }

  snapshot(): Map<string, TimeseriesSample[]> {
    return new Map([...this.runtime].map(([id, runtime]) => [id, runtime.buffer.toArray()]));
  }
}
