import { describe, expect, it } from 'vitest';
import { decimateXY, intervalStatistics, xyCsv, xyData } from './analysis';
import { getDesiredSources, sanitizeConfig, sourceKey } from './config';
import { TimeSeriesEngine } from './engine';
import { liveView, selectionView, zoomView } from './plot';

const config = (extra = {}) =>
  sanitizeConfig({
    schemaVersion: 5,
    mode: 'xy',
    xSeriesId: 'x',
    series: [
      { id: 'x', topic: '/pose', messageType: 'Pose', fieldPath: 'x', enabled: false, label: 'X' },
      { id: 'y', topic: '/pose', messageType: 'Pose', fieldPath: 'y', label: 'Y' },
    ],
    ...extra,
  });
const source = (topic = '/pose') => ({ topic, key: sourceKey(topic, 'Pose'), messageType: 'Pose', throttleMs: 0 });

describe('XY pairing', () => {
  it('pairs processed values from the same message, captures hidden X and preserves capture time in CSV', () => {
    const engine = new TimeSeriesEngine(config());
    expect(getDesiredSources(engine.config)).toHaveLength(1);
    engine.receive(source(), { x: 2, y: 3 }, 1000);
    engine.receive(source(), { x: 1, y: 7 }, 1100);
    const points = xyData(engine.snapshot(), engine.config);
    expect(points.get('y')).toMatchObject([
      { time: 2, value: 3, sourceTime: 1000 },
      { time: 1, value: 7, sourceTime: 1100 },
    ]);
    expect(points.has('x')).toBe(false);
    engine.reconnect();
    engine.receive(source(), { x: 3, y: 8 }, 1200);
    expect(xyData(engine.snapshot(), engine.config).get('y')?.[2].breakBefore).toBe(true);
    expect(xyCsv(points, engine.config)).toBe('series,time_ms,x,y\n"Y",1000,2,3\n"Y",1100,1,7');
    const range = liveView(points, engine.config);
    expect(range.start).toBeLessThan(1);
    expect(range.end).toBeGreaterThan(2);
  });
  it('does not combine distinct messages with equal timestamps and breaks trajectories around unmatched samples', () => {
    const engine = new TimeSeriesEngine(config());
    engine.receive(source(), { x: 1 }, 1000);
    engine.receive(source(), { y: 2 }, 1000);
    expect(xyData(engine.snapshot(), engine.config).get('y')).toEqual([]);
    engine.receive(source(), { x: 3, y: 4 }, 1100);
    engine.receive(source(), { y: 5 }, 1200);
    engine.receive(source(), { x: 6, y: 7 }, 1300);
    expect(
      xyData(engine.snapshot(), engine.config)
        .get('y')
        ?.map(p => p.breakBefore)
    ).toEqual([true, true]);
  });
  it('makes cross-topic latest-X pairing explicit, refuses future/stale values and never bridges reconnections', () => {
    const c = config({ xyPairing: 'latest', xyToleranceMs: 50 });
    c.series[1].topic = '/other';
    const engine = new TimeSeriesEngine(c);
    expect(
      getDesiredSources(c)
        .map(s => s.topic)
        .sort()
    ).toEqual(['/other', '/pose']);
    engine.receive(source(), { x: 10 }, 1000);
    engine.receive(source('/other'), { y: 1 }, 1050);
    engine.receive(source('/other'), { y: 2 }, 1051);
    engine.receive(source('/other'), { y: 3 }, 999);
    expect(xyData(engine.snapshot(), c).get('y')).toMatchObject([{ time: 10, value: 1 }]);
    engine.reconnect();
    engine.receive(source('/other'), { y: 4 }, 1010);
    expect(xyData(engine.snapshot(), c).get('y')).toHaveLength(1);
    engine.receive(source(), { x: 20 }, 1100);
    engine.receive(source('/other'), { y: 5 }, 1110);
    expect(xyData(engine.snapshot(), c).get('y')).toMatchObject([
      { time: 10, value: 1 },
      { time: 20, value: 5, breakBefore: true },
    ]);
    expect(xyData(engine.snapshot(), { ...c, xyPairing: 'message' }).get('y')).toEqual([]);
  });
  it('supports nonmonotonic X coordinates and sub-unit zoom without changing time-mode limits', () => {
    const v = { start: 0.001, end: 0.002, min: -1, max: 1 };
    expect(zoomView(v, 0.5, 0.5, 0.5, 'xy').end - zoomView(v, 0.5, 0.5, 0.5, 'xy').start).toBeCloseTo(0.0005);
    expect(zoomView(v, 0.5).end - zoomView(v, 0.5).start).toBe(1);
    expect(selectionView({ x: 70, y: 30 }, { x: 150, y: 90 }, v, 300, 200, 'xy')).not.toBeNull();
    expect(selectionView({ x: 70, y: 30 }, { x: 150, y: 90 }, v, 300, 200)).toBeNull();
  });
});

describe('interval statistics', () => {
  it('uses every finite captured sample inside inclusive time bounds, before canvas decimation', () => {
    const samples = [
      { time: 0, value: 999 },
      { time: 1, value: 2 },
      { time: 2, value: 4 },
      { time: 3, value: 6 },
      { time: 4, value: NaN },
    ];
    expect(intervalStatistics(samples, 1, 3)).toMatchObject({ count: 3, min: 2, max: 6, mean: 4, delta: 4 });
    expect(intervalStatistics(samples, 1, 3).rms).toBeCloseTo(Math.sqrt(56 / 3));
    expect(intervalStatistics(samples, 1, 3).std).toBeCloseTo(Math.sqrt(8 / 3));
    expect(intervalStatistics(samples, 2, 2)).toMatchObject({ count: 1, rms: 4, std: 0, delta: 0 });
    expect(intervalStatistics(samples, 9, 10)).toEqual({
      count: 0,
      min: null,
      max: null,
      mean: null,
      rms: null,
      std: null,
      delta: null,
    });
    expect(intervalStatistics(samples, 3, 1).count).toBe(0);
    expect(
      intervalStatistics(
        [
          { time: 0, value: 1e200 },
          { time: 1, value: 1e200 },
        ],
        0,
        1
      ).rms
    ).toBe(1e200);
  });
});

it('migrates previous configs to time mode and round-trips explicit XY options without changing signal identities', () => {
  for (const schemaVersion of [3, 4]) {
    const previous = { ...config(), schemaVersion, mode: undefined, xSeriesId: undefined };
    expect(sanitizeConfig(previous)).toMatchObject({ schemaVersion: 5, mode: 'time', xSeriesId: '' });
    expect(sanitizeConfig(previous).series.map(s => s.id)).toEqual(['x', 'y']);
  }
  const c = config({ xyPairing: 'latest', xyStyle: 'scatter', xyToleranceMs: 30 });
  expect(sanitizeConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
  expect(sanitizeConfig({ ...c, xSeriesId: 'missing', xyToleranceMs: 1e9 })).toMatchObject({
    xSeriesId: '',
    xyToleranceMs: 2000,
  });
});

it('bounds dense XY drawing without sorting a looping path and carries gaps through skipped samples', () => {
  const samples = Array.from({ length: 10000 }, (_, event) => ({
    event,
    time: Math.sin(event),
    value: Math.cos(event),
    breakBefore: event === 50,
  }));
  const reduced = decimateXY(samples, 100);
  expect(reduced.length).toBeLessThanOrEqual(100);
  expect(reduced[0].event).toBe(0);
  expect(reduced[reduced.length - 1]?.event).toBe(9999);
  expect(reduced[1].breakBefore).toBe(true);
  expect(reduced.every((sample, i) => i === 0 || sample.event! > reduced[i - 1].event!)).toBe(true);
  expect(decimateXY([], 0)).toEqual([]);
});

it('does not invent same-message associations for samples without message identity', () => {
  const c = config();
  const points = xyData(
    new Map([
      ['x', [{ time: 1, value: 2 }]],
      ['y', [{ time: 1, value: 3 }]],
    ]),
    c
  );
  expect(points.get('y')).toEqual([]);
});
