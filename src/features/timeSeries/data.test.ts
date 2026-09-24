import { assert, test } from 'vitest';
import {
  RealtimeFilter,
  SampleBuffer,
  chooseAutoPlotFields,
  createCsv,
  decimateSamples,
  discoverNumericFields,
  getNumericValueAtPath,
  getPlotRange,
} from './data.ts';

test('reads and discovers bounded nested numeric ROS fields', () => {
  const message = { pose: { position: { x: 1.25 } }, ranges: [2, 3], label: 'arm' };
  assert.equal(getNumericValueAtPath(message, 'pose.position.x'), 1.25);
  assert.equal(getNumericValueAtPath(message, 'ranges[1]'), 3);
  assert.equal(getNumericValueAtPath(message, 'pose.position'), null);
  assert.deepEqual(discoverNumericFields(message), ['pose.position.x', 'ranges[0]', 'ranges[1]']);
});

test('automatic fields prefer telemetry values over ROS timestamps', () => {
  assert.deepEqual(chooseAutoPlotFields(['header.stamp.sec', 'header.stamp.nanosec', 'position[0]', 'position[1]']), [
    'position[0]',
    'position[1]',
  ]);
  assert.deepEqual(chooseAutoPlotFields(['stamp.sec']), ['stamp.sec']);
});

test('sample buffers evict by age and capacity without rebuilding history', () => {
  const buffer = new SampleBuffer(3);
  buffer.push({ time: 0, value: 1 });
  buffer.push({ time: 1000, value: 2 });
  buffer.push({ time: 2000, value: 3 });
  buffer.push({ time: 3000, value: 4 }, 1500);
  assert.equal(buffer.size, 2);
  assert.deepEqual(buffer.toArray(), [
    { time: 2000, value: 3 },
    { time: 3000, value: 4 },
  ]);
  assert.deepEqual(buffer.latest(), { time: 3000, value: 4 });
  buffer.clear();
  assert.equal(buffer.size, 0);
});

test('raw, moving-average, and exponential filters update incrementally', () => {
  const raw = new RealtimeFilter({ type: 'raw' });
  assert.equal(raw.next(4), 4);

  const moving = new RealtimeFilter({ type: 'movingAverage', window: 3 });
  assert.deepEqual([moving.next(1), moving.next(2), moving.next(6), moving.next(10)], [1, 1.5, 3, 6]);

  const ema = new RealtimeFilter({ type: 'ema', alpha: 0.5 });
  assert.deepEqual([ema.next(10), ema.next(14), ema.next(6)], [10, 12, 9]);
});

test('decimation stays bounded and preserves endpoints and extrema', () => {
  const samples = Array.from({ length: 1000 }, (_, index) => ({
    time: index,
    value: index === 500 ? 1000 : Math.sin(index),
  }));
  const reduced = decimateSamples(samples, 100);
  assert.ok(reduced.length <= 100);
  assert.deepEqual(reduced[0], samples[0]);
  assert.deepEqual(reduced[reduced.length - 1], samples[samples.length - 1]);
  assert.ok(reduced.some(sample => sample.value === 1000));
});

test('calculates auto and fixed plot ranges', () => {
  assert.deepEqual(getPlotRange([{ time: 0, value: 5 }], true), { min: 4, max: 6 });
  assert.deepEqual(getPlotRange([], false, 10, -10), { min: -10, max: 10 });
});

test('exports ordered long-form CSV', () => {
  const csv = createCsv(
    new Map([
      ['/pose · x [m]', [{ time: 1000, value: 2 }]],
      ['/pose · y [m]', [{ time: 1500, value: 3 }]],
    ])
  );
  assert.match(csv, /^timestamp_iso,elapsed_seconds,series,value/m);
  assert.match(csv, /0\.000000,"\/pose · x \[m\]",2/);
  assert.match(csv, /0\.500000,"\/pose · y \[m\]",3/);
});

test('exports the maximum 16 by 10,000 sample capture without argument-stack overflow', () => {
  const data = new Map(
    Array.from({ length: 16 }, (_, i) => [String(i), Array.from({ length: 10000 }, (_, time) => ({ time, value: i }))])
  );
  const csv = createCsv(data);
  assert.equal(csv.split('\n').length, 160002);
});
