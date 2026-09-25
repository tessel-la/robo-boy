import { compileExpression, INPUT_ID_KEYS, sanitizeMath, type MathConfig } from './math';
import type { FilterConfig } from './data';
import { chooseAutoPlotFields, isRosTimestampField } from './data';

export const SERIES_LIMIT = 16;
export const AUTO_PLOT_FIELD_LIMIT = 8;

export const COLORS = [
  '#57d68d',
  '#5ca9ff',
  '#ffb454',
  '#ff7597',
  '#bd93f9',
  '#35d0ba',
  '#f9e264',
  '#8be9fd',
  '#ff8f5c',
  '#7ee787',
  '#d2a8ff',
  '#79c0ff',
  '#ffa657',
  '#a5d6ff',
  '#f2cc60',
  '#db6dbe',
] as const;

export interface TimeseriesSeriesConfig {
  id: string;
  topic: string;
  messageType: string;
  /** Empty only while a newly selected topic is awaiting field discovery. */
  fieldPath: string;
  enabled: boolean;
  label: string;
  unit: string;
  color: string;
  filter: FilterConfig;
  math: MathConfig;
}

export interface TimeseriesConfig {
  schemaVersion: 4;
  series: TimeseriesSeriesConfig[];
  timeWindowSec: number;
  sampleLimit: number;
  throttleMs: number;
  renderFps: number;
  autoScale: boolean;
  minY: number;
  maxY: number;
  showPoints: boolean;
}

export const DEFAULT_CONFIG: TimeseriesConfig = {
  schemaVersion: 4,
  series: [],
  timeWindowSec: 15,
  sampleLimit: 1200,
  throttleMs: 33,
  renderFps: 20,
  autoScale: true,
  minY: -1,
  maxY: 1,
  showPoints: false,
};

interface LegacyConfig {
  schemaVersion?: number;
  topic?: unknown;
  messageType?: unknown;
  fieldPaths?: unknown;
  timeWindowSec?: unknown;
  sampleLimit?: unknown;
  throttleMs?: unknown;
  renderFps?: unknown;
  autoScale?: unknown;
  minY?: unknown;
  maxY?: unknown;
  showPoints?: unknown;
}

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
};

const hash = (value: string): string => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
};

export const sourceKey = (topic: string, messageType: string): string => `${topic}\u0000${messageType}`;

export const createSeriesId = (topic: string, fieldPath: string, used: ReadonlySet<string>): string => {
  const base = `series-${hash(`${topic}\u0000${fieldPath}`)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
};

const sanitizeFilter = (value: unknown): FilterConfig => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (candidate.type === 'movingAverage') {
    return {
      type: 'movingAverage',
      window: Math.round(clamp(candidate.window, 10, 2, 500)),
    };
  }
  if (candidate.type === 'ema') {
    return { type: 'ema', alpha: clamp(candidate.alpha, 0.2, 0.01, 1) };
  }
  return { type: 'raw' };
};

const sanitizeSeries = (value: unknown, index: number, usedIds: Set<string>): TimeseriesSeriesConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TimeseriesSeriesConfig>;
  const topic = typeof candidate.topic === 'string' ? candidate.topic.trim() : '';
  const messageType = typeof candidate.messageType === 'string' ? candidate.messageType.trim() : '';
  const fieldPath = typeof candidate.fieldPath === 'string' ? candidate.fieldPath.trim() : '';
  if (!topic || !messageType) return null;
  const requestedId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const id =
    requestedId && !usedIds.has(requestedId)
      ? requestedId
      : createSeriesId(topic, fieldPath || `pending-${index}`, usedIds);
  usedIds.add(id);
  return {
    id,
    topic,
    messageType,
    fieldPath,
    enabled: candidate.enabled !== false,
    label: typeof candidate.label === 'string' ? candidate.label.trim().slice(0, 80) : '',
    unit: typeof candidate.unit === 'string' ? candidate.unit.trim().slice(0, 24) : '',
    color:
      typeof candidate.color === 'string' && /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color
        : COLORS[index % COLORS.length],
    filter: sanitizeFilter(candidate.filter),
    math: sanitizeMath(candidate.math),
  };
};

const migrateLegacySeries = (candidate: LegacyConfig): TimeseriesSeriesConfig[] => {
  const topic = typeof candidate.topic === 'string' ? candidate.topic.trim() : '';
  const messageType = typeof candidate.messageType === 'string' ? candidate.messageType.trim() : '';
  if (!topic || !messageType) return [];
  const fields = Array.isArray(candidate.fieldPaths)
    ? [
        ...new Set(
          candidate.fieldPaths
            .filter((path): path is string => typeof path === 'string')
            .map(path => path.trim())
            .filter(Boolean)
        ),
      ]
    : [];
  const shouldDropLegacyTimestamps =
    candidate.schemaVersion !== 2 &&
    fields.some(isRosTimestampField) &&
    fields.some(path => !isRosTimestampField(path));
  const normalizedFields = shouldDropLegacyTimestamps
    ? chooseAutoPlotFields(fields, AUTO_PLOT_FIELD_LIMIT)
    : fields.slice(0, AUTO_PLOT_FIELD_LIMIT);
  const paths = normalizedFields.length ? normalizedFields : [''];
  const used = new Set<string>();
  return paths.map((fieldPath, index) => {
    const id = createSeriesId(topic, fieldPath || 'pending', used);
    used.add(id);
    return {
      id,
      topic,
      messageType,
      fieldPath,
      enabled: true,
      label: '',
      unit: '',
      color: COLORS[index % COLORS.length],
      filter: { type: 'raw' },
      math: sanitizeMath(null),
    };
  });
};

export const sanitizeConfig = (value: unknown): TimeseriesConfig => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown> & LegacyConfig) : {};
  const usedIds = new Set<string>();
  const series =
    (candidate.schemaVersion === 3 || candidate.schemaVersion === 4) && Array.isArray(candidate.series)
      ? candidate.series
          .slice(0, SERIES_LIMIT)
          .map((item, index) => sanitizeSeries(item, index, usedIds))
          .filter((item): item is TimeseriesSeriesConfig => item !== null)
          .slice(0, SERIES_LIMIT)
      : migrateLegacySeries(candidate);
  return {
    schemaVersion: 4,
    series,
    timeWindowSec: clamp(candidate.timeWindowSec, DEFAULT_CONFIG.timeWindowSec, 1, 600),
    sampleLimit: Math.round(clamp(candidate.sampleLimit, DEFAULT_CONFIG.sampleLimit, 100, 10000)),
    throttleMs: Math.round(clamp(candidate.throttleMs, DEFAULT_CONFIG.throttleMs, 0, 2000)),
    renderFps: Math.round(clamp(candidate.renderFps, DEFAULT_CONFIG.renderFps, 5, 60)),
    autoScale: candidate.autoScale !== false,
    minY: clamp(candidate.minY, DEFAULT_CONFIG.minY, -1e12, 1e12),
    maxY: clamp(candidate.maxY, DEFAULT_CONFIG.maxY, -1e12, 1e12),
    showPoints: candidate.showPoints === true,
  };
};

export interface TopicSource {
  key: string;
  topic: string;
  messageType: string;
  throttleMs: number;
}

export const getDesiredSources = (config: TimeseriesConfig): TopicSource[] => {
  const sources = new Map<string, TopicSource>();
  config.series
    .filter(series => series.enabled)
    .forEach(series => {
      const key = sourceKey(series.topic, series.messageType);
      sources.set(key, {
        key,
        topic: series.topic,
        messageType: series.messageType,
        throttleMs: config.throttleMs,
      });
    });
  config.series
    .filter(series => series.enabled)
    .forEach(series => {
      // Inputs are raw fields of other signals, often hidden ones; their topics must stay subscribed.
      mathInputs(series.math).forEach(name => {
        const input = config.series.find(item => item.id === series.math[INPUT_ID_KEYS[name]]);
        if (!input) return;
        const key = sourceKey(input.topic, input.messageType);
        sources.set(key, { key, topic: input.topic, messageType: input.messageType, throttleMs: config.throttleMs });
      });
    });
  return [...sources.values()];
};

/** The input variables an expression reads; none when it does not compile. */
export const mathInputs = (math: MathConfig) => {
  try {
    return compileExpression(math.expression).inputs;
  } catch {
    return [];
  }
};

export const displayName = (series: TimeseriesSeriesConfig): string => {
  if (series.label) return series.label;
  if (!series.fieldPath) return `${series.topic} · detecting fields…`;
  return `${series.topic} · ${series.fieldPath}`;
};
