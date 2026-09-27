import { FiCheck, FiTrash2, FiX } from 'react-icons/fi';
import { useEffect, useId, useState } from 'react';
import type { Ros } from 'roslib';
import {
  COLORS,
  SERIES_LIMIT,
  createSeriesId,
  displayName,
  mathInputs,
  sanitizeConfig,
  sourceKey,
  type TimeseriesConfig,
  type TimeseriesSeriesConfig,
} from './config';
import type { TimeSeriesEngine } from './engine';
import { EXPRESSION_HELP, INPUT_ID_KEYS, INPUT_VARIABLES, sanitizeMath } from './math';

function NumberSetting({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        key={value}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step="any"
        disabled={disabled}
        onBlur={event => {
          const n = event.currentTarget.valueAsNumber;
          if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
          else event.currentTarget.value = String(value);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
interface Props {
  config: TimeseriesConfig;
  engine: TimeSeriesEngine;
  ros: Ros | null;
  connected: boolean;
  onChange: (config: TimeseriesConfig) => void;
  onClose: () => void;
}
export default function TimeSeriesSettings({ config, engine, ros, connected, onChange, onClose }: Props) {
  const [topics, setTopics] = useState<Array<{ name: string; messageType: string }>>([]);
  const [query, setQuery] = useState('');
  const [topicError, setTopicError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [customSource, setCustomSource] = useState('');
  const [customField, setCustomField] = useState('');
  const [notice, setNotice] = useState('');
  const listId = useId();
  useEffect(() => {
    if (!ros || !connected) return;
    let cancelled = false;
    setTopicError('Loading topics…');
    const timeout = setTimeout(() => {
      if (!cancelled) setTopicError('Topic discovery timed out. Try Refresh topics.');
    }, 8000);
    ros.getTopics(
      result => {
        if (cancelled) return;
        clearTimeout(timeout);
        setTopics(result.topics.map((name, i) => ({ name, messageType: result.types[i] })).filter(t => t.messageType));
        setTopicError('');
      },
      error => {
        if (!cancelled) {
          clearTimeout(timeout);
          setTopicError(String(error));
        }
      }
    );
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [ros, connected, refresh]);
  const changeSeries = (id: string, patch: Partial<TimeseriesSeriesConfig>) =>
    onChange({ ...config, series: config.series.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  const add = (topic: string, messageType: string, fieldPath = '', duplicate?: TimeseriesSeriesConfig) => {
    if (config.series.length >= SERIES_LIMIT) {
      setNotice('The panel supports up to 16 signals.');
      return;
    }
    if (
      !duplicate &&
      config.series.some(s => s.topic === topic && s.messageType === messageType && s.fieldPath === fieldPath)
    ) {
      setNotice('That signal is already configured. Use Duplicate to derive another curve.');
      return;
    }
    const id = createSeriesId(topic, fieldPath, new Set(config.series.map(s => s.id)));
    const series: TimeseriesSeriesConfig = duplicate
      ? {
          ...duplicate,
          id,
          label: `${duplicate.label || duplicate.fieldPath} derived`,
          math: { ...duplicate.math },
          color: COLORS[config.series.length % COLORS.length],
        }
      : {
          id,
          topic,
          messageType,
          fieldPath,
          enabled: true,
          label: '',
          unit: '',
          color: COLORS[config.series.length % COLORS.length],
          filter: { type: 'raw' },
          math: sanitizeMath(null),
        };
    onChange({ ...config, series: [...config.series, series] });
    setNotice('');
  };
  const sources = [...new Map(config.series.map(s => [sourceKey(s.topic, s.messageType), s])).values()];
  const source = sources.find(s => sourceKey(s.topic, s.messageType) === customSource) ?? sources[0];
  return (
    <section
      className="timeseries-settings"
      aria-label="Time series settings"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>Time Series settings</strong>
        <button onClick={onClose} autoFocus aria-label="Close Time Series settings">
          <FiX aria-hidden="true" />
        </button>
      </header>
      <div className="timeseries-settings-content">
        <details open={config.series.length === 0} className="timeseries-section">
          <summary>Add ROS topic</summary>
          <label>
            Search topics
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="/joint_states or sensor_msgs…" />
          </label>
          <button onClick={() => setRefresh(n => n + 1)} disabled={!connected}>
            Refresh topics
          </button>
          {!connected && <p>Connect to ROS to discover topics. Saved signals can still be edited.</p>}
          {topicError && <p role="status">{topicError}</p>}
          <div className="timeseries-topic-list">
            {topics
              .filter(t => `${t.name} ${t.messageType}`.toLowerCase().includes(query.toLowerCase()))
              .map(t => (
                <button
                  key={`${t.name}:${t.messageType}`}
                  onClick={() => add(t.name, t.messageType)}
                  disabled={
                    config.series.length >= SERIES_LIMIT ||
                    config.series.some(s => s.topic === t.name && s.messageType === t.messageType)
                  }
                  title={`${t.name} · ${t.messageType}`}
                >
                  <span>{t.name}</span>
                  <small>{t.messageType}</small>
                </button>
              ))}
            {connected && !topicError && !topics.length && <p>No ROS topics available.</p>}
          </div>
        </details>
        <p className="timeseries-muted">
          {config.series.length} / {SERIES_LIMIT} signals · changes save immediately
        </p>
        {notice && <p role="status">{notice}</p>}
        {config.series.map(s => (
          <section key={s.id} className="timeseries-signal" aria-label={displayName(s)}>
            <div className="timeseries-signal-heading">
              <label className="timeseries-signal-toggle">
                <input
                  type="checkbox"
                  aria-label={`Show ${displayName(s)}`}
                  checked={s.enabled}
                  onChange={e => changeSeries(s.id, { enabled: e.target.checked })}
                />
                <i style={{ background: s.color }} />
                <strong title={displayName(s)}>{displayName(s)}</strong>
              </label>
              <button
                onClick={() => onChange({ ...config, series: config.series.filter(item => item.id !== s.id) })}
                aria-label={`Remove ${displayName(s)}`}
              >
                <FiTrash2 aria-hidden="true" />
              </button>
            </div>
            {!s.fieldPath && (
              <p>
                {engine.discovered.get(sourceKey(s.topic, s.messageType))?.length === 0
                  ? 'No numeric fields found. Enter a custom field path below or choose another topic.'
                  : 'Waiting for numeric fields. You can enter a field path below.'}
              </p>
            )}
            <div className="timeseries-grid">
              <label>
                Smoothing
                <select
                  value={s.filter.type}
                  onChange={e =>
                    changeSeries(s.id, {
                      filter:
                        e.target.value === 'ema'
                          ? { type: 'ema', alpha: 0.2 }
                          : e.target.value === 'movingAverage'
                            ? { type: 'movingAverage', window: 10 }
                            : { type: 'raw' },
                    })
                  }
                >
                  <option value="raw">Raw · no filter</option>
                  <option value="movingAverage">Moving average</option>
                  <option value="ema">Exponential average</option>
                </select>
              </label>
              {s.filter.type === 'movingAverage' && (
                <NumberSetting
                  label="Filter window (samples)"
                  value={s.filter.window}
                  min={2}
                  max={500}
                  onChange={window =>
                    changeSeries(s.id, { filter: { type: 'movingAverage', window: Math.round(window) } })
                  }
                />
              )}
              {s.filter.type === 'ema' && (
                <NumberSetting
                  label="EMA factor"
                  value={s.filter.alpha}
                  min={0.01}
                  max={1}
                  onChange={alpha => changeSeries(s.id, { filter: { type: 'ema', alpha } })}
                />
              )}
            </div>
            <details>
              <summary>Label, unit and source</summary>
              <div className="timeseries-grid">
                <label>
                  Label
                  <input value={s.label} maxLength={80} onChange={e => changeSeries(s.id, { label: e.target.value })} />
                </label>
                <label>
                  Unit
                  <input value={s.unit} maxLength={24} onChange={e => changeSeries(s.id, { unit: e.target.value })} />
                </label>
                <label>
                  Color
                  <input type="color" value={s.color} onChange={e => changeSeries(s.id, { color: e.target.value })} />
                </label>
                <label>
                  Field path
                  <input
                    value={s.fieldPath}
                    onChange={e => changeSeries(s.id, { fieldPath: e.target.value })}
                    placeholder="pose.position.x"
                  />
                </label>
              </div>
              <p className="timeseries-source">
                {s.topic}
                <br />
                {s.messageType}
              </p>
            </details>
            <details>
              <summary>Math and derived signal</summary>
              <p className="timeseries-muted">
                Expression → scale + offset → operation → smoothing. x is this raw field; y, z and w are other
                signals' raw fields. Duplicate to retain the original curve.
              </p>
              <label>
                Expression
                <input
                  value={s.math.expression}
                  maxLength={256}
                  placeholder="x - y"
                  onChange={e => changeSeries(s.id, { math: { ...s.math, expression: e.target.value } })}
                />
              </label>
              <p className="timeseries-muted">
                {EXPRESSION_HELP} Examples: sqrt(x^2 + y^2 + z^2), deg(atan2(2*(w*z + x*y), 1 - 2*(y^2 + z^2))).
              </p>
              {INPUT_VARIABLES.filter(name => name === 'y' || mathInputs(s.math).includes(name) || s.math[INPUT_ID_KEYS[name]]).map(name => (
                <label key={name}>
                  {name === 'y' ? 'Secondary signal (y)' : `Input signal (${name})`}
                  <select
                    value={s.math[INPUT_ID_KEYS[name]]}
                    onChange={e => changeSeries(s.id, { math: { ...s.math, [INPUT_ID_KEYS[name]]: e.target.value } })}
                  >
                    <option value="">Choose a signal…</option>
                    {config.series
                      .filter(item => item.id !== s.id && item.fieldPath)
                      .map(item => (
                        <option key={item.id} value={item.id}>
                          {displayName(item)}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              <p className="timeseries-muted">
                Samples follow x arrivals, using the latest y within the time window. Hidden inputs remain subscribed
                when needed.
              </p>
              <div className="timeseries-grid">
                <NumberSetting
                  label="Scale"
                  value={s.math.scale}
                  onChange={scale => changeSeries(s.id, { math: { ...s.math, scale } })}
                />
                <NumberSetting
                  label="Offset"
                  value={s.math.offset}
                  onChange={offset => changeSeries(s.id, { math: { ...s.math, offset } })}
                />
                <label>
                  Operation
                  <select
                    value={s.math.operation}
                    onChange={e =>
                      changeSeries(s.id, { math: { ...s.math, operation: e.target.value as typeof s.math.operation } })
                    }
                  >
                    <option value="identity">None</option>
                    <option value="normalize">Normalize to range</option>
                    <option value="derivative">Derivative / second</option>
                    <option value="integral">Integral · seconds</option>
                  </select>
                </label>
                {s.math.operation === 'normalize' && (
                  <>
                    <NumberSetting
                      label="Normalization minimum"
                      value={s.math.normalizeMin}
                      onChange={normalizeMin => changeSeries(s.id, { math: { ...s.math, normalizeMin } })}
                    />
                    <NumberSetting
                      label="Normalization maximum"
                      value={s.math.normalizeMax}
                      onChange={normalizeMax => changeSeries(s.id, { math: { ...s.math, normalizeMax } })}
                    />
                  </>
                )}
              </div>
              <button
                disabled={config.series.length >= SERIES_LIMIT}
                onClick={() => add(s.topic, s.messageType, s.fieldPath, s)}
              >
                Duplicate as derived signal
              </button>
              {engine.errors.has(s.id) && <p role="alert">{engine.errors.get(s.id)}</p>}
            </details>
          </section>
        ))}
        {sources.length > 0 && (
          <section className="timeseries-section">
            <strong>Add another field</strong>
            <label>
              Configured topic
              <select
                value={source ? sourceKey(source.topic, source.messageType) : ''}
                onChange={e => setCustomSource(e.target.value)}
              >
                {sources.map(s => (
                  <option key={sourceKey(s.topic, s.messageType)} value={sourceKey(s.topic, s.messageType)}>
                    {s.topic}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Numeric field
              <input
                list={listId}
                value={customField}
                onChange={e => setCustomField(e.target.value)}
                placeholder="Choose detected field or enter a custom path"
              />
            </label>
            <datalist id={listId}>
              {(source ? (engine.discovered.get(sourceKey(source.topic, source.messageType)) ?? []) : []).map(path => (
                <option key={path} value={path} />
              ))}
            </datalist>
            <button
              disabled={!source || !customField.trim() || config.series.length >= SERIES_LIMIT}
              onClick={() => {
                if (source) {
                  add(source.topic, source.messageType, customField.trim());
                  setCustomField('');
                }
              }}
            >
              Add field
            </button>
          </section>
        )}
        <details className="timeseries-section">
          <summary>Plot and performance</summary>
          <div className="timeseries-grid">
            <NumberSetting
              label="Time window (seconds)"
              value={config.timeWindowSec}
              min={1}
              max={600}
              onChange={timeWindowSec => onChange({ ...config, timeWindowSec })}
            />
            <NumberSetting
              label="Samples per signal"
              value={config.sampleLimit}
              min={100}
              max={10000}
              onChange={sampleLimit => onChange(sanitizeConfig({ ...config, sampleLimit }))}
            />
            <NumberSetting
              label="Bridge throttle (ms)"
              value={config.throttleMs}
              min={0}
              max={2000}
              onChange={throttleMs => onChange(sanitizeConfig({ ...config, throttleMs }))}
            />
            <NumberSetting
              label="Graph refresh (Hz)"
              value={config.renderFps}
              min={5}
              max={60}
              onChange={renderFps => onChange(sanitizeConfig({ ...config, renderFps }))}
            />
            <label className="timeseries-check">
              <input
                type="checkbox"
                checked={config.autoScale}
                onChange={e => onChange({ ...config, autoScale: e.target.checked })}
              />
              Auto Y range
            </label>
            <label className="timeseries-check">
              <input
                type="checkbox"
                checked={config.showPoints}
                onChange={e => onChange({ ...config, showPoints: e.target.checked })}
              />
              Point markers
            </label>
            <NumberSetting
              label="Y minimum"
              min={-1e12}
              max={1e12}
              value={config.minY}
              disabled={config.autoScale}
              onChange={minY => onChange({ ...config, minY })}
            />
            <NumberSetting
              label="Y maximum"
              min={-1e12}
              max={1e12}
              value={config.maxY}
              disabled={config.autoScale}
              onChange={maxY => onChange({ ...config, maxY })}
            />
          </div>
          <p className="timeseries-muted">
            0 ms throttle retains every message. Captured history is limited by both time and sample count. Reset / Live
            restores this Y configuration after zooming.
          </p>
        </details>
      </div>
      <footer>
        <span className="timeseries-muted">Changes saved automatically</span>
        <button className="timeseries-accent" onClick={onClose}>
          <FiCheck aria-hidden="true" />
          Done
        </button>
      </footer>
    </section>
  );
}
