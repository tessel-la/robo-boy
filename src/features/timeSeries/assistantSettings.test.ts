import { describe, expect, it } from 'vitest';
import { applyTimeSeriesSettings, describeTimeSeries } from './assistantSettings';
import { sanitizeConfig, sourceKey, type TimeseriesConfig } from './config';
import { TimeSeriesEngine } from './engine';

const ODOM = 'nav_msgs/msg/Odometry';
const topicTypes = new Map([['/odom', ODOM], ['/cmd_vel', 'geometry_msgs/msg/Twist'], ['/imu', 'sensor_msgs/msg/Imu']]);
const signal = (id: string, topic: string, fieldPath: string, extra: Record<string, unknown> = {}) => ({
  id, topic, messageType: topicTypes.get(topic)!, fieldPath, ...extra,
});
const config = (series: unknown[], extra: Record<string, unknown> = {}) =>
  sanitizeConfig({ schemaVersion: 4, series, ...extra });
const apply = (current: TimeseriesConfig, settings: Record<string, unknown>, discovered?: Map<string, string[]>) =>
  applyTimeSeriesSettings(current, settings, { topicTypes, discovered });
const messages = (result: ReturnType<typeof apply>) => result.outcomes.map(outcome => `${outcome.ok ? '✓' : '✗'} ${outcome.message}`);

describe('describeTimeSeries', () => {
  it('reports plot settings and whether each signal is actually plotting', () => {
    const engine = new TimeSeriesEngine(config([
      signal('speed', '/odom', 'twist.twist.linear.x', { label: 'Speed', unit: 'm/s', filter: { type: 'ema', alpha: 0.3 } }),
      signal('sq', '/odom', 'twist.twist.linear.x', { math: { expression: 'x^2', scale: 2 } }),
      signal('cmd', '/cmd_vel', 'linear.x', { enabled: false }),
      signal('auto', '/imu', ''),
    ], { sampleLimit: 100, timeWindowSec: 30, autoScale: false, minY: -2, maxY: 2 }));
    const source = { key: sourceKey('/odom', ODOM), topic: '/odom', messageType: ODOM, throttleMs: 0 };
    for (let step = 0; step < 150; step++) engine.receive(source, { twist: { twist: { linear: { x: step / 100 } } } }, 1_000 + step * 10);

    const described = describeTimeSeries(engine);
    expect(described).toMatchObject({ timeWindowSec: 30, sampleLimit: 100, yAxis: { min: -2, max: 2 }, paused: false, maxSignals: 16 });
    const signals = described.signals as Array<Record<string, unknown>>;
    expect(signals[0]).toMatchObject({ id: 'speed', name: 'Speed', unit: 'm/s', filter: { type: 'ema', alpha: 0.3 } });
    expect(signals[0].math).toBeUndefined();
    expect(signals[0].status).toMatch(/^plotting, 100 samples, latest 1\.4\d*; sample limit reached — only the last 1\.0 s of the 30 s window is kept$/);
    expect(signals[1].math).toEqual({ expression: 'x^2', scale: 2 });
    expect(signals[2]).toMatchObject({ visible: false, status: 'hidden' });
    expect(signals[3].status).toBe('detecting numeric fields from the first message');
    expect(described.numericFieldsByTopic).toEqual({ '/odom': ['twist.twist.linear.x'] });
  });
});

describe('applyTimeSeriesSettings', () => {
  it('adds signals by topic, reading the type from the ROS graph', () => {
    const result = apply(config([]), { addSignals: [
      { topic: '/odom', fieldPath: 'twist.twist.linear.x', label: 'Speed', unit: 'm/s', color: 'red' },
      { topic: '/imu' },
      { topic: '/nope', fieldPath: 'data' },
    ] });
    expect(messages(result)).toEqual([
      '✓ Added "Speed".',
      '✓ Added /imu; its numeric fields are picked when the first message arrives.',
      '✗ /nope is not in the ROS graph, so its message type is unknown.',
    ]);
    expect(result.config.series).toMatchObject([
      { topic: '/odom', messageType: ODOM, fieldPath: 'twist.twist.linear.x', label: 'Speed', unit: 'm/s', color: '#ff5c5c', enabled: true },
      { topic: '/imu', messageType: 'sensor_msgs/msg/Imu', fieldPath: '' },
    ]);
  });

  it('adds a derived curve and keeps the original', () => {
    const current = config([signal('speed', '/odom', 'twist.twist.linear.x', { label: 'Speed' })]);
    const result = apply(current, { addSignals: [{ from: 'Speed', label: 'Speed²', math: { expression: 'x^2' } }] });
    expect(messages(result)).toEqual(['✓ Added "Speed²", derived from "Speed".']);
    expect(result.config.series).toHaveLength(2);
    expect(result.config.series[1]).toMatchObject({ topic: '/odom', fieldPath: 'twist.twist.linear.x', label: 'Speed²', math: { expression: 'x^2' } });
  });

  it('combines signals, adding hidden inputs for fields not plotted yet', () => {
    const current = config([signal('vx', '/odom', 'twist.twist.linear.x')]);
    const result = apply(current, { addSignals: [{
      topic: '/odom', fieldPath: 'twist.twist.linear.x', label: 'Planar speed',
      math: { expression: 'hypot(x, y)', inputs: { y: { topic: '/odom', fieldPath: 'twist.twist.linear.y' } } },
    }, {
      topic: '/imu', fieldPath: 'orientation.x', label: 'Yaw', unit: '°',
      math: {
        expression: 'deg(atan2(2*(w*z + x*y), 1 - 2*(y^2 + z^2)))',
        inputs: { y: { topic: '/imu', fieldPath: 'orientation.y' }, z: { topic: '/imu', fieldPath: 'orientation.z' }, w: { topic: '/imu', fieldPath: 'orientation.w' } },
      },
    }] });
    expect(messages(result)).toEqual([
      '✓ Added /odom twist.twist.linear.y as a hidden input.',
      '✓ Added "Planar speed".',
      '✓ Added /imu orientation.y as a hidden input.',
      '✓ Added /imu orientation.z as a hidden input.',
      '✓ Added /imu orientation.w as a hidden input.',
      '✓ Added "Yaw".',
    ]);
    const byLabel = (label: string) => result.config.series.find(item => item.label === label)!;
    const hidden = (field: string) => result.config.series.find(item => item.fieldPath === field)!;
    expect(hidden('twist.twist.linear.y').enabled).toBe(false);
    expect(byLabel('Planar speed').math.secondaryId).toBe(hidden('twist.twist.linear.y').id);
    expect(byLabel('Yaw').math).toMatchObject({
      secondaryId: hidden('orientation.y').id, tertiaryId: hidden('orientation.z').id, quaternaryId: hidden('orientation.w').id,
    });
  });

  it('uses existing signals as inputs and refuses math it cannot run', () => {
    const current = config([signal('cmd', '/cmd_vel', 'linear.x', { label: 'Commanded' }), signal('meas', '/odom', 'twist.twist.linear.x', { label: 'Measured' })]);
    const result = apply(current, { updateSignals: [
      { signal: 'Measured', math: { expression: 'x - y', inputs: { y: 'Commanded' } }, label: 'Speed error' },
      { signal: 'cmd', math: { expression: 'x - y' } },
      { signal: 'cmd', math: { expression: 'x +* 2' } },
      { signal: 'cmd', math: { expression: 'x', inputs: { y: 'cmd' } } },
      { signal: 'cmd', math: { operation: 'normalize', normalizeMin: 1, normalizeMax: 1 } },
      { signal: 'ghost', label: 'x' },
    ] });
    expect(messages(result)).toEqual([
      '✓ Updated "Speed error" (math, label).',
      '✗ Did not change "Commanded": The expression uses y, so "inputs" must name a signal for it.',
      expect.stringMatching(/^✗ Did not change "Commanded": Invalid math for "Commanded": Unexpected "\*"\. Use numbers, x, y, z, w/),
      '✗ Did not change "Commanded": A signal cannot be its own input.',
      '✗ Did not change "Commanded": Invalid math for "Commanded": Normalization maximum must exceed minimum.',
      '✗ No signal ghost to update.',
    ]);
    expect(result.config.series[1]).toMatchObject({ label: 'Speed error', math: { expression: 'x - y', secondaryId: 'cmd' } });
    expect(result.config.series[0].math.expression).toBe('x');
  });

  it('merges math, smoothing and presentation changes', () => {
    const current = config([signal('s', '/odom', 'twist.twist.linear.x', { math: { expression: 'x^2' } })]);
    const result = apply(current, { updateSignals: [{
      signal: { topic: '/odom', fieldPath: 'twist.twist.linear.x' },
      math: { scale: 3.6, operation: 'derivative' }, filter: { type: 'movingAverage', window: 20 }, visible: false, color: '#123abc', unit: 'km/h',
    }, { signal: 's', filter: { type: 'median' } }, { signal: 's', color: 'plaid' }] });
    expect(result.outcomes.map(outcome => outcome.ok)).toEqual([true, false, false]);
    expect(result.outcomes[1].message).toContain('Unknown filter "median"');
    expect(result.outcomes[2].message).toContain('Unknown colour "plaid"');
    expect(result.config.series[0]).toMatchObject({
      enabled: false, color: '#123abc', unit: 'km/h', filter: { type: 'movingAverage', window: 20 },
      math: { expression: 'x^2', scale: 3.6, operation: 'derivative' },
    });
  });

  it('checks field paths against the fields a topic actually has', () => {
    const current = config([signal('s', '/odom', 'twist.twist.linear.x')]);
    const discovered = new Map([[sourceKey('/odom', ODOM), ['pose.pose.position.x', 'twist.twist.linear.x', 'twist.twist.linear.y', 'twist.twist.angular.z']]]);
    const result = apply(current, {
      addSignals: [{ topic: '/odom', fieldPath: 'twist.linear.x' }, { topic: '/odom', fieldPath: '.twist.twist.angular.z' }],
      updateSignals: [{ signal: 's', fieldPath: 'pose.position.x' }],
    }, discovered);
    expect(messages(result)).toEqual([
      '✗ /odom has no numeric field "twist.linear.x". Did you mean twist.twist.linear.x?',
      '✓ Added "/odom · twist.twist.angular.z".',
      '✗ /odom has no numeric field "pose.position.x". Did you mean pose.pose.position.x?',
    ]);
  });

  it('writes array indexes the way the engine reads them and skips duplicates', () => {
    const current = config([signal('r', '/imu', 'orientation_covariance[0]')]);
    const result = apply(current, { addSignals: [{ topic: '/imu', fieldPath: 'orientation_covariance.0' }, { topic: '/imu', fieldPath: 'linear_acceleration.z' }] });
    expect(messages(result)).toEqual(['✓ "/imu · orientation_covariance[0]" is already plotted.', '✓ Added "/imu · linear_acceleration.z".']);
  });

  it('removes signals and says which derived curves lose an input', () => {
    const current = config([
      signal('a', '/odom', 'twist.twist.linear.x', { label: 'A' }),
      signal('b', '/cmd_vel', 'linear.x', { label: 'B', math: { expression: 'x - y', secondaryId: 'a' } }),
      signal('c', '/imu', 'linear_acceleration.x'),
    ]);
    const result = apply(current, { removeSignals: ['A', 'missing'] });
    expect(messages(result)).toEqual(['✓ Removed "A". "B" used it as an input and will wait for a new one.', '✗ No signal missing to remove.']);
    expect(result.config.series.map(item => item.id)).toEqual(['b', 'c']);
    expect(apply(current, { removeAllSignals: true }).config.series).toEqual([]);
  });

  it('refuses to go past the signal limit', () => {
    const full = config(Array.from({ length: 16 }, (_, index) => signal(`s${index}`, '/odom', `f${index}`)));
    const result = apply(full, { addSignals: [{ topic: '/imu', fieldPath: 'linear_acceleration.x' }] });
    expect(messages(result)).toEqual(['✗ Cannot add /imu linear_acceleration.x: at most 16 signals.']);
  });

  it('applies plot settings and reports clamped values', () => {
    const current = config([]);
    const result = apply(current, { timeWindowSec: 1200, sampleLimit: 6000, showPoints: true, yRange: { min: -1, max: 5 }, paused: true, clear: true });
    expect(messages(result)).toEqual([
      '✓ Time window set to 600 s (1200 s is outside the allowed range).',
      '✓ Samples kept per signal set to 6000.',
      '✓ Showing sample points.',
      '✓ Y axis fixed to -1 … 5.',
      '✓ Paused the plot; data keeps being processed.',
      '✓ Cleared the captured history.',
    ]);
    expect(result).toMatchObject({ paused: true, clear: true, config: { timeWindowSec: 600, sampleLimit: 6000, showPoints: true, autoScale: false, minY: -1, maxY: 5 } });

    const back = apply(result.config, { autoScale: true, throttleMs: 'fast', yRange: undefined });
    expect(messages(back)).toEqual(['✗ throttleMs must be a number.', '✓ Y axis scales automatically.']);
    expect(apply(current, { yRange: { min: 3, max: 3 } }).outcomes[0]).toEqual({ ok: false, message: 'The Y range needs max above min (got 3 to 3).' });
  });

  it('explains itself when nothing in the patch applies', () => {
    const result = apply(config([]), { colourScheme: 'dark' });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].message).toMatch(/^Nothing in those settings applies to the Time Series panel\. Signals are referred to/);
  });
});
