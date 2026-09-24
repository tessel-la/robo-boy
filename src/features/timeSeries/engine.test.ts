import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, getDesiredSources, sanitizeConfig, sourceKey } from './config';
import { TimeSeriesEngine } from './engine';
import { compileExpression, sanitizeMath, SignalMath } from './math';
const source = (topic = '/a') => ({ key: sourceKey(topic, 'T'), topic, messageType: 'T', throttleMs: 0 });
const series = (id = 'a', topic = '/a', math = {}) => ({ id, topic, messageType: 'T', fieldPath: 'value', math });
const config = (signals: unknown[]) => sanitizeConfig({ ...DEFAULT_CONFIG, series: signals });

describe('signal math', () => {
  it('parses bounded arithmetic with conventional precedence and scalar functions', () => {
    expect(compileExpression('sqrt(x*x + y*y)').evaluate(3, 4)).toBe(5);
    expect(compileExpression('-2^2 + 2^-2').evaluate(0, 0)).toBe(-3.75);
    expect(compileExpression('min(abs(x), max(y, 2e1))').evaluate(-30, 10)).toBe(20);
    expect(compileExpression('2^3^2').evaluate(0, 0)).toBe(512);
    for (const input of [
      'window.alert(1)',
      'x.constructor',
      'this',
      'x; y',
      '1/0; fetch(x)',
      'sqrt()',
      'min(x)',
      'constructor(x)',
      'x'.repeat(257),
    ])
      expect(() => compileExpression(input)).toThrow();
  });
  it('scales, offsets, normalizes and handles zero-time derivative/integral safely', () => {
    const normalized = new SignalMath(
      sanitizeMath({ scale: 2, offset: 2, operation: 'normalize', normalizeMin: 0, normalizeMax: 10 })
    );
    expect(normalized.next(2, 0, 1000)).toBe(0.6);
    const derivative = new SignalMath(sanitizeMath({ operation: 'derivative' }));
    expect(derivative.next(1, 0, 1000)).toBeNull();
    expect(derivative.next(99, 0, 1000)).toBeNull();
    expect(derivative.next(5, 0, 3000)).toBe(2);
    const integral = new SignalMath(sanitizeMath({ operation: 'integral' }));
    expect(integral.next(2, 0, 1000)).toBe(0);
    expect(integral.next(4, 0, 3000)).toBe(6);
    expect(() => new SignalMath(sanitizeMath({ operation: 'normalize', normalizeMin: 2, normalizeMax: 2 }))).toThrow();
    const raw = new SignalMath(sanitizeMath(null));
    expect(raw.next(1, 0, 1000)).toBe(1);
    expect(raw.next(2, 0, 1000)).toBe(2);
  });
});

describe('streaming engine', () => {
  it('auto-discovers nested/indexed telemetry, preserving the placeholder identity and first samples', () => {
    const engine = new TimeSeriesEngine(config([{ ...series(), fieldPath: '' }]));
    const next = engine.receive(source(), { header: { stamp: { sec: 5 } }, position: [3, 4] }, 1000)!;
    expect(next.series.map(s => s.fieldPath)).toEqual(['position[0]', 'position[1]']);
    expect(next.series[0].id).toBe('a');
    expect([...engine.snapshot().values()].map(v => v[0].value)).toEqual([3, 4]);
  });
  it('combines latest raw inputs, subscribes hidden dependencies, and suppresses stale/invalid values', () => {
    const engine = new TimeSeriesEngine(
      config([series('a', '/a', { expression: 'x - y', secondaryId: 'b' }), { ...series('b', '/b'), enabled: false }])
    );
    expect(getDesiredSources(engine.config).map(s => s.topic)).toEqual(['/a', '/b']);
    engine.receive(source(), { value: 9 }, 1000);
    expect(engine.runtime.get('a')!.buffer.size).toBe(0);
    engine.receive(source('/b'), { value: 4 }, 1500);
    engine.receive(source(), { value: 9 }, 2000);
    expect(engine.runtime.get('a')!.buffer.latest()?.value).toBe(5);
    engine.receive(source(), { value: 9 }, 20000);
    expect(engine.runtime.get('a')!.buffer.size).toBe(1);
    engine.receive(source('/b'), { value: NaN }, 20001);
    engine.receive(source(), { value: 10 }, 20002);
    expect(engine.runtime.get('a')!.buffer.size).toBe(1);
  });
  it('updates filters during pause, resets affected histories only, and preserves presentation edits', () => {
    const engine = new TimeSeriesEngine(
      config([{ ...series(), filter: { type: 'ema', alpha: 0.5 } }, series('b', '/b')])
    );
    engine.receive(source(), { value: 2 }, 1000);
    engine.receive(source('/b'), { value: 1 }, 1000);
    engine.paused = true;
    engine.receive(source(), { value: 6 }, 2000);
    expect(engine.runtime.get('a')!.buffer.latest()?.value).toBe(2);
    engine.paused = false;
    engine.receive(source(), { value: 8 }, 3000);
    expect(engine.runtime.get('a')!.buffer.latest()?.value).toBe(6);
    engine.configure({ ...engine.config, series: engine.config.series.map(s => ({ ...s, label: 'edited' })) });
    expect(engine.runtime.get('a')!.buffer.size).toBe(2);
    engine.configure({
      ...engine.config,
      series: engine.config.series.map(s =>
        s.id === 'a' ? { ...s, math: sanitizeMath({ operation: 'integral' }) } : s
      ),
    });
    expect(engine.runtime.get('a')!.buffer.size).toBe(0);
    expect(engine.runtime.get('b')!.buffer.size).toBe(1);
    engine.clear();
    expect([...engine.runtime.values()].every(r => r.buffer.size === 0)).toBe(true);
  });
  it('keeps 16 streams bounded during 200 Hz capture with filters and transforms', () => {
    const signals = Array.from({ length: 16 }, (_, i) => ({
      ...series(String(i), `/topic${i}`, { scale: 2, operation: i % 2 ? 'integral' : 'derivative' }),
      filter: { type: 'movingAverage', window: 20 },
    }));
    const engine = new TimeSeriesEngine(sanitizeConfig({ ...config(signals), sampleLimit: 1000 }));
    const start = performance.now();
    for (let tick = 0; tick < 4000; tick++)
      for (let i = 0; i < 16; i++) engine.receive(source(`/topic${i}`), { value: Math.sin(tick / 10) }, tick * 5);
    const elapsed = performance.now() - start;
    expect([...engine.runtime.values()].every(r => r.buffer.size === 1000)).toBe(true);
    // 64k arrivals represent 20 seconds of 16 x 200 Hz telemetry; loose guard catches quadratic regressions.
    expect(elapsed).toBeLessThan(5000);
    console.info(`Time Series: 64,000 arrivals / 16 streams in ${elapsed.toFixed(1)} ms`);
  });
});
