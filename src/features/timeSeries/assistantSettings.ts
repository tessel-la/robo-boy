import { COLORS, SERIES_LIMIT, createSeriesId, displayName, mathInputs, sanitizeConfig, sourceKey, type TimeseriesConfig, type TimeseriesSeriesConfig } from './config';
import type { FilterConfig } from './data';
import type { TimeSeriesEngine } from './engine';
import { EXPRESSION_HELP, INPUT_ID_KEYS, INPUT_VARIABLES, SignalMath, sanitizeMath, type MathConfig } from './math';

/**
 * The Time Series side of the assistant's panel-settings bridge. `describe` tells the model what
 * the plot shows and how well each signal is doing; `apply` turns its patch into a new, sanitized
 * configuration and reports every change in the user's terms. Both are pure so the rules are
 * tested without a canvas or a robot.
 */
export const TIME_SERIES_SETTINGS_HELP = [
  'Signals are referred to by "id" from "signals", by label, or as {"topic","fieldPath"}.',
  '"addSignals": array of {"topic", "fieldPath" (dot/index path such as "twist.twist.linear.x" or "position[0]"; omit to auto-pick up to 8 numeric fields), "messageType" (optional, read from the ROS graph), "label", "unit", "color" (#rrggbb or a colour name), "visible", "filter", "math"}.',
  'A derived curve: {"from": <signal>, "label", "math": {...}} copies that signal\'s source and keeps the original curve.',
  '"updateSignals": array of {"signal": <signal>, and any of "label", "unit", "color", "visible", "fieldPath", "filter", "math"} (math fields merge into the current ones).',
  '"removeSignals": array of <signal>; "removeAllSignals": true.',
  '"filter": {"type":"raw"} | {"type":"movingAverage","window":2–500 samples} | {"type":"ema","alpha":0.01–1}.',
  `"math": {"expression" (x is the signal's own field; y, z, w are other signals' raw fields — ${EXPRESSION_HELP}), "inputs": {"y": <signal>, "z": <signal>, "w": <signal>} (a {"topic","fieldPath"} not yet plotted is added as a hidden input), "scale", "offset", "operation": "identity"|"normalize"|"derivative"|"integral" (derivative/integral per second), "normalizeMin", "normalizeMax"}. Pipeline: expression → scale·v + offset → operation → filter.`,
  'Examples: squared {"expression":"x^2"}; difference of two signals {"expression":"x - y","inputs":{"y":…}}; speed from a velocity vector {"expression":"sqrt(x^2 + y^2 + z^2)"}; yaw in degrees from a quaternion (x,y,z,w fields) {"expression":"deg(atan2(2*(w*z + x*y), 1 - 2*(y^2 + z^2)))"}.',
  `Plot: "timeWindowSec" (1–600), "sampleLimit" (samples kept per signal, 100–10000 — a signal at R Hz needs about window × R), "yRange": {"min","max"} (manual axis) or "autoScale": true, "showPoints", "throttleMs" (0–2000, bridge rate limit per topic), "renderFps" (5–60), "paused" (freeze the plot while data keeps processing), "clear": true (drop captured history). At most ${SERIES_LIMIT} signals.`,
].join(' ');

type Outcome = { ok: boolean; message: string };
type SignalRef = string | { topic?: unknown; fieldPath?: unknown } | undefined | null;

export interface TimeSeriesApplyContext {
  /** Topic → message type, from the ROS graph. */
  topicTypes: ReadonlyMap<string, string>;
  /** Numeric fields already seen per source (`sourceKey`), to catch a wrong path before it plots nothing. */
  discovered?: ReadonlyMap<string, readonly string[]>;
}
export interface TimeSeriesApplyResult {
  config: TimeseriesConfig;
  outcomes: Outcome[];
  paused?: boolean;
  clear?: boolean;
}

const NAMED_COLORS: Record<string, string> = {
  red: '#ff5c5c', green: '#57d68d', blue: '#5ca9ff', orange: '#ffb454', yellow: '#f9e264', purple: '#bd93f9',
  pink: '#ff7597', cyan: '#8be9fd', teal: '#35d0ba', white: '#f5f5f5', gray: '#9aa0a6', grey: '#9aa0a6',
};
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
/** The engine's path form: dots between fields, brackets for array indexes ("ranges[0]"). */
const normalizeField = (path: string) => path.trim().replace(/^\.+/, '').replace(/\.(\d+)(?=[.[]|$)/g, '[$1]');

const describeMath = (math: MathConfig, series: readonly TimeseriesSeriesConfig[]) => {
  const inputs = Object.fromEntries(
    mathInputs(math).map(name => {
      const input = series.find(item => item.id === math[INPUT_ID_KEYS[name]]);
      return [name, input ? input.id : 'not set'];
    })
  );
  return {
    expression: math.expression,
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(math.scale !== 1 ? { scale: math.scale } : {}),
    ...(math.offset !== 0 ? { offset: math.offset } : {}),
    ...(math.operation !== 'identity' ? { operation: math.operation } : {}),
    ...(math.operation === 'normalize' ? { normalizeMin: math.normalizeMin, normalizeMax: math.normalizeMax } : {}),
  };
};
const isDefaultMath = (math: MathConfig) =>
  math.expression === 'x' && math.scale === 1 && math.offset === 0 && math.operation === 'identity';

/** What the model sees for this panel: its settings, and whether each signal actually plots. */
export const describeTimeSeries = (engine: TimeSeriesEngine): Record<string, unknown> => {
  const { config } = engine;
  const windowMs = config.timeWindowSec * 1000;
  const signals = config.series.map(series => {
    const runtime = engine.runtime.get(series.id);
    const size = runtime?.buffer.size ?? 0;
    const error = engine.errors.get(series.id);
    let status: string;
    if (!series.fieldPath) status = 'detecting numeric fields from the first message';
    else if (error) status = error;
    else if (!series.enabled) status = 'hidden';
    else if (!size) status = 'no samples yet (field missing, topic silent, or not connected)';
    else {
      const samples = runtime!.buffer.toArray();
      const span = (samples[samples.length - 1].time - samples[0].time) / 1000;
      const latest = samples[samples.length - 1].value;
      status = `plotting, ${size} samples, latest ${Number(latest.toPrecision(6))}`;
      if (size >= config.sampleLimit && span * 1000 < windowMs * 0.9) {
        status += `; sample limit reached — only the last ${span.toFixed(1)} s of the ${config.timeWindowSec} s window is kept`;
      }
    }
    return {
      id: series.id,
      name: displayName(series),
      topic: series.topic,
      messageType: series.messageType,
      fieldPath: series.fieldPath,
      visible: series.enabled,
      ...(series.unit ? { unit: series.unit } : {}),
      color: series.color,
      ...(series.filter.type !== 'raw' ? { filter: series.filter } : {}),
      ...(isDefaultMath(series.math) ? {} : { math: describeMath(series.math, config.series) }),
      status,
    };
  });
  return {
    timeWindowSec: config.timeWindowSec,
    sampleLimit: config.sampleLimit,
    yAxis: config.autoScale ? 'auto' : { min: config.minY, max: config.maxY },
    showPoints: config.showPoints,
    throttleMs: config.throttleMs,
    renderFps: config.renderFps,
    paused: engine.paused,
    signals,
    /** Numeric fields seen on each plotted topic, so a new signal can name a real one. */
    numericFieldsByTopic: Object.fromEntries(
      [...engine.discovered].map(([key, fields]) => [key.split('\u0000')[0], fields.slice(0, 64)])
    ),
    maxSignals: SERIES_LIMIT,
  };
};

/** Applies the model's patch. Unknown keys and invalid values are reported, never guessed. */
export const applyTimeSeriesSettings = (
  current: TimeseriesConfig,
  settings: Record<string, unknown>,
  { topicTypes, discovered }: TimeSeriesApplyContext
): TimeSeriesApplyResult => {
  let series = current.series.map(item => ({ ...item, math: { ...item.math } }));
  const outcomes: Outcome[] = [];
  const ok = (message: string) => outcomes.push({ ok: true, message });
  const fail = (message: string) => outcomes.push({ ok: false, message });
  const usedIds = () => new Set(series.map(item => item.id));
  const name = (item: TimeseriesSeriesConfig) => `"${displayName(item)}"`;

  const find = (ref: SignalRef): TimeseriesSeriesConfig | undefined => {
    if (isRecord(ref)) {
      const topic = text(ref.topic);
      const field = normalizeField(text(ref.fieldPath));
      const matches = series.filter(item => item.topic === topic && normalizeField(item.fieldPath) === field);
      return matches.find(item => isDefaultMath(item.math)) ?? matches[0];
    }
    const wanted = text(ref).toLowerCase();
    if (!wanted) return undefined;
    return (
      series.find(item => item.id.toLowerCase() === wanted) ??
      series.find(item => item.label.toLowerCase() === wanted) ??
      series.find(item => displayName(item).toLowerCase() === wanted) ??
      series.find(item => `${item.topic} ${item.fieldPath}`.toLowerCase() === wanted.replace(/\s*·\s*/, ' '))
    );
  };
  const describeRef = (ref: SignalRef) => (isRecord(ref) ? `${text(ref.topic)} ${text(ref.fieldPath)}`.trim() : text(ref)) || 'an unnamed signal';
  const messageTypeFor = (topic: string, requested: string) =>
    requested || topicTypes.get(topic) || series.find(item => item.topic === topic)?.messageType || '';

  const room = () => SERIES_LIMIT - series.length;
  /** A path the first message showed does not exist, when discovery saw the whole message. */
  const unknownField = (topic: string, messageType: string, fieldPath: string): string | null => {
    const fields = discovered?.get(sourceKey(topic, messageType));
    // Discovery stops at 64 fields and 64 array items; past that a path may still be real.
    if (!fields || fields.length >= 64 || fields.includes(fieldPath) || /\[(?:6[4-9]|[7-9]\d|\d{3,})\]/.test(fieldPath)) return null;
    // Rank by how many trailing segments agree: "pose.position.x" → "pose.pose.position.x".
    const wanted = fieldPath.toLowerCase().split('.').reverse();
    const score = (field: string) => {
      const segments = field.toLowerCase().split('.').reverse();
      let matched = 0;
      while (matched < wanted.length && segments[matched] === wanted[matched]) matched++;
      return matched;
    };
    const best = Math.max(0, ...fields.map(score));
    const similar = best ? fields.filter(field => score(field) === best).slice(0, 6) : [];
    return `${topic} has no numeric field "${fieldPath}". ${similar.length ? `Did you mean ${similar.join(', ')}?` : `Its numeric fields: ${fields.slice(0, 12).join(', ')}.`}`;
  };
  const newSignal = (topic: string, messageType: string, fieldPath: string, patch: Partial<TimeseriesSeriesConfig> = {}): TimeseriesSeriesConfig => ({
    id: createSeriesId(topic, fieldPath || 'pending', usedIds()),
    topic,
    messageType,
    fieldPath,
    enabled: true,
    label: '',
    unit: '',
    color: COLORS[series.length % COLORS.length],
    filter: { type: 'raw' },
    math: sanitizeMath(null),
    ...patch,
  });

  /** Resolves a math input, adding a hidden raw signal for a {topic, fieldPath} not plotted yet. */
  const resolveInput = (ref: SignalRef, owner: string): TimeseriesSeriesConfig | string => {
    const existing = find(ref);
    if (existing) return existing.id === owner ? 'A signal cannot be its own input.' : existing;
    if (!isRecord(ref)) return `No signal ${describeRef(ref)} to use as an input.`;
    const topic = text(ref.topic);
    const fieldPath = normalizeField(text(ref.fieldPath));
    const messageType = messageTypeFor(topic, text((ref as Record<string, unknown>).messageType));
    if (!topic || !fieldPath) return 'An input needs a topic and a fieldPath.';
    if (!messageType) return `${topic} is not in the ROS graph.`;
    const wrongInput = unknownField(topic, messageType, fieldPath);
    if (wrongInput) return wrongInput;
    if (room() < 1) return `No room for input ${topic} ${fieldPath}: at most ${SERIES_LIMIT} signals.`;
    const hidden = newSignal(topic, messageType, fieldPath, { enabled: false });
    series.push(hidden);
    ok(`Added ${topic} ${fieldPath} as a hidden input.`);
    return hidden;
  };

  const parseFilter = (value: unknown): FilterConfig | string => {
    const raw = typeof value === 'string' ? { type: value } : value;
    if (!isRecord(raw)) return 'A filter is an object like {"type":"ema","alpha":0.2}.';
    const type = text(raw.type);
    if (type === 'raw' || type === 'none') return { type: 'raw' };
    if (type === 'movingAverage' || type === 'moving_average') {
      const window = finite(raw.window) ?? 10;
      if (window < 2 || window > 500) return 'A moving average window is 2–500 samples.';
      return { type: 'movingAverage', window: Math.round(window) };
    }
    if (type === 'ema') {
      const alpha = finite(raw.alpha) ?? 0.2;
      if (alpha < 0.01 || alpha > 1) return 'An EMA alpha is 0.01–1.';
      return { type: 'ema', alpha };
    }
    return `Unknown filter "${type}". Use raw, movingAverage or ema.`;
  };

  /** Merges a math patch, validates it and resolves inputs; returns an error in the user's terms. */
  const mergeMath = (target: TimeseriesSeriesConfig, patch: unknown): MathConfig | string => {
    if (!isRecord(patch)) return 'math must be an object.';
    const next: MathConfig = { ...target.math };
    if (patch.expression !== undefined) next.expression = text(patch.expression);
    for (const key of ['scale', 'offset', 'normalizeMin', 'normalizeMax'] as const) {
      if (patch[key] === undefined) continue;
      const value = finite(patch[key]);
      if (value === undefined) return `${key} must be a number.`;
      next[key] = value;
    }
    if (patch.operation !== undefined) {
      const operation = text(patch.operation);
      if (!['identity', 'normalize', 'derivative', 'integral'].includes(operation)) return `Unknown operation "${operation}".`;
      next.operation = operation as MathConfig['operation'];
    }
    const inputs = isRecord(patch.inputs) ? patch.inputs : {};
    if (patch.secondaryId !== undefined && inputs.y === undefined) inputs.y = patch.secondaryId;
    for (const variable of INPUT_VARIABLES) {
      if (inputs[variable] === undefined) continue;
      const input = resolveInput(inputs[variable] as SignalRef, target.id);
      if (typeof input === 'string') return input;
      next[INPUT_ID_KEYS[variable]] = input.id;
    }
    try {
      new SignalMath(next);
    } catch (error) {
      return `Invalid math for ${name(target)}: ${(error as Error).message}`;
    }
    const missing = mathInputs(next).filter(variable => !series.some(item => item.id === next[INPUT_ID_KEYS[variable]] && item.id !== target.id));
    if (missing.length) return `The expression uses ${missing.join(', ')}, so "inputs" must name a signal for ${missing.length > 1 ? 'each' : 'it'}.`;
    return next;
  };

  const parseColor = (value: unknown) => {
    const wanted = text(value).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(wanted)) return wanted;
    return NAMED_COLORS[wanted];
  };

  /** Applies presentation and processing keys shared by add and update. */
  const applyFields = (target: TimeseriesSeriesConfig, entry: Record<string, unknown>): string[] => {
    const problems: string[] = [];
    if (entry.label !== undefined) target.label = text(entry.label).slice(0, 80);
    if (entry.unit !== undefined) target.unit = text(entry.unit).slice(0, 24);
    if (entry.color !== undefined) {
      const color = parseColor(entry.color);
      if (color) target.color = color;
      else problems.push(`Unknown colour "${text(entry.color)}"; use #rrggbb.`);
    }
    const visible = entry.visible ?? entry.enabled;
    if (typeof visible === 'boolean') target.enabled = visible;
    if (entry.filter !== undefined) {
      const filter = parseFilter(entry.filter);
      if (typeof filter === 'string') problems.push(filter);
      else target.filter = filter;
    }
    if (entry.math !== undefined) {
      const math = mergeMath(target, entry.math);
      if (typeof math === 'string') problems.push(math);
      else target.math = math;
    }
    return problems;
  };

  // 1. Removals first, so a replace-everything request has room for the new signals.
  if (settings.removeAllSignals === true && series.length) {
    ok(`Removed all ${series.length} signals.`);
    series = [];
  }
  if (Array.isArray(settings.removeSignals)) {
    for (const ref of settings.removeSignals as SignalRef[]) {
      const target = find(ref);
      if (!target) {
        fail(`No signal ${describeRef(ref)} to remove.`);
        continue;
      }
      series = series.filter(item => item.id !== target.id);
      const orphaned = series.filter(item => INPUT_VARIABLES.some(variable => item.math[INPUT_ID_KEYS[variable]] === target.id && mathInputs(item.math).includes(variable)));
      ok(`Removed ${name(target)}.${orphaned.length ? ` ${orphaned.map(name).join(', ')} used it as an input and will wait for a new one.` : ''}`);
    }
  }

  // 2. Additions, in order, so later entries can use earlier ones as inputs.
  if (Array.isArray(settings.addSignals)) {
    for (const raw of settings.addSignals) {
      const entry = isRecord(raw) ? raw : {};
      const source = entry.from !== undefined ? find(entry.from as SignalRef) : undefined;
      if (entry.from !== undefined && !source) {
        fail(`No signal ${describeRef(entry.from as SignalRef)} to derive from.`);
        continue;
      }
      const topic = source?.topic ?? text(entry.topic);
      const fieldPath = source?.fieldPath ?? normalizeField(text(entry.fieldPath));
      const messageType = source?.messageType ?? messageTypeFor(topic, text(entry.messageType));
      if (!topic) {
        fail('A new signal needs a "topic" (or "from" for a derived curve).');
        continue;
      }
      if (!messageType) {
        fail(`${topic} is not in the ROS graph, so its message type is unknown.`);
        continue;
      }
      const wrongField = fieldPath && !source ? unknownField(topic, messageType, fieldPath) : null;
      if (wrongField) {
        fail(wrongField);
        continue;
      }
      if (!fieldPath && entry.math !== undefined) {
        fail(`Math needs a specific field of ${topic}; give a "fieldPath".`);
        continue;
      }
      if (room() < 1) {
        fail(`Cannot add ${topic} ${fieldPath}: at most ${SERIES_LIMIT} signals.`);
        continue;
      }
      const signal = newSignal(topic, messageType, fieldPath, source ? { filter: source.filter, unit: source.unit } : {});
      const problems = applyFields(signal, entry);
      if (problems.length) {
        fail(`Did not add ${topic} ${fieldPath}: ${problems.join(' ')}`);
        continue;
      }
      const duplicate = series.find(
        item => item.topic === signal.topic && item.messageType === signal.messageType && item.fieldPath === signal.fieldPath &&
          JSON.stringify([item.math, item.filter]) === JSON.stringify([signal.math, signal.filter])
      );
      if (duplicate) {
        if (!duplicate.enabled && signal.enabled) duplicate.enabled = true;
        ok(`${name(duplicate)} is already plotted${signal.enabled && duplicate.enabled ? '' : ' (now shown)'}.`);
        continue;
      }
      series.push(signal);
      ok(
        !fieldPath
          ? `Added ${topic}; its numeric fields are picked when the first message arrives.`
          : `Added ${name(signal)}${source ? `, derived from ${name(source)}` : ''}${signal.enabled ? '' : ' (hidden)'}.`
      );
    }
  }

  // 3. Updates.
  if (Array.isArray(settings.updateSignals)) {
    for (const raw of settings.updateSignals) {
      const entry = isRecord(raw) ? raw : {};
      const ref = (entry.signal ?? entry.id) as SignalRef;
      const target = find(ref);
      if (!target) {
        fail(`No signal ${describeRef(ref)} to update.`);
        continue;
      }
      const draft: TimeseriesSeriesConfig = { ...target, math: { ...target.math } };
      if (entry.fieldPath !== undefined) {
        const fieldPath = normalizeField(text(entry.fieldPath));
        if (!fieldPath) {
          fail(`fieldPath for ${name(target)} cannot be empty.`);
          continue;
        }
        const wrongField = unknownField(target.topic, target.messageType, fieldPath);
        if (wrongField) {
          fail(wrongField);
          continue;
        }
        draft.fieldPath = fieldPath;
      }
      const problems = applyFields(draft, entry);
      if (problems.length) {
        fail(`Did not change ${name(target)}: ${problems.join(' ')}`);
        continue;
      }
      const changed = Object.keys(entry).filter(key => key !== 'signal' && key !== 'id');
      series = series.map(item => (item.id === target.id ? draft : item));
      ok(changed.length ? `Updated ${name(draft)} (${changed.join(', ')}).` : `Nothing to change on ${name(target)}.`);
    }
  }

  // 4. Plot settings, reported after clamping so the user hears what actually applies.
  const plot: Partial<TimeseriesConfig> = {};
  for (const key of ['timeWindowSec', 'sampleLimit', 'throttleMs', 'renderFps'] as const) {
    if (settings[key] === undefined) continue;
    const value = finite(settings[key]);
    if (value === undefined) fail(`${key} must be a number.`);
    else plot[key] = value;
  }
  if (typeof settings.showPoints === 'boolean') plot.showPoints = settings.showPoints;
  const range = isRecord(settings.yRange) ? settings.yRange : settings.minY !== undefined || settings.maxY !== undefined ? { min: settings.minY, max: settings.maxY } : undefined;
  if (range) {
    const min = finite(range.min) ?? current.minY;
    const max = finite(range.max) ?? current.maxY;
    if (max <= min) fail(`The Y range needs max above min (got ${min} to ${max}).`);
    else Object.assign(plot, { autoScale: false, minY: min, maxY: max });
  } else if (settings.autoScale === true || settings.yAxis === 'auto') {
    plot.autoScale = true;
  } else if (settings.autoScale === false) {
    plot.autoScale = false;
  }

  const config = sanitizeConfig({ ...current, ...plot, series });
  const labels: Record<string, [string, string]> = {
    timeWindowSec: ['Time window', ' s'], sampleLimit: ['Samples kept per signal', ''], throttleMs: ['Bridge throttle', ' ms'], renderFps: ['Render rate', ' Hz'],
  };
  for (const [key, [label, unit]] of Object.entries(labels)) {
    const requested = plot[key as keyof typeof plot];
    if (requested === undefined) continue;
    const applied = config[key as keyof TimeseriesConfig] as number;
    ok(`${label} set to ${applied}${unit}${applied !== requested ? ` (${requested}${unit} is outside the allowed range)` : ''}.`);
  }
  if (plot.showPoints !== undefined) ok(plot.showPoints ? 'Showing sample points.' : 'Hid sample points.');
  if (plot.autoScale === false && range) ok(`Y axis fixed to ${config.minY} … ${config.maxY}.`);
  else if (plot.autoScale === true) ok('Y axis scales automatically.');
  else if (plot.autoScale === false) ok(`Y axis fixed to ${config.minY} … ${config.maxY}.`);

  // 5. Engine actions.
  const result: TimeSeriesApplyResult = { config, outcomes };
  if (typeof settings.paused === 'boolean') {
    result.paused = settings.paused;
    ok(settings.paused ? 'Paused the plot; data keeps being processed.' : 'Resumed the plot.');
  }
  if (settings.clear === true) {
    result.clear = true;
    ok('Cleared the captured history.');
  }
  if (!outcomes.length) fail(`Nothing in those settings applies to the Time Series panel. ${TIME_SERIES_SETTINGS_HELP}`);
  return result;
};

