import { expect, it } from 'vitest';
import { liveView, nearestSample, selectionView, zoomView } from './plot';
import { sanitizeConfig } from './config';
it('maps reverse rectangle selection to both axes and ignores accidental taps', () => {
  const v = { start: 0, end: 10000, min: -10, max: 10 };
  expect(selectionView({ x: 55, y: 16 }, { x: 55, y: 17 }, v, 269, 246)).toBeNull();
  expect(selectionView({ x: 205, y: 166 }, { x: 105, y: 66 }, v, 269, 246)).toEqual({
    start: 2500,
    end: 7500,
    min: -5,
    max: 5,
  });
  expect(zoomView(v, 2)).toEqual({ start: -5000, end: 15000, min: -20, max: 20 });
  expect(
    nearestSample(
      [
        { time: 1, value: 3 },
        { time: 5, value: 4 },
      ],
      4
    )?.value
  ).toBe(4);
});
it('auto-scales only enabled in-window data, while manual range remains available', () => {
  const config = sanitizeConfig({
    schemaVersion: 4,
    timeWindowSec: 1,
    series: [
      { id: 'a', topic: '/a', messageType: 'T', fieldPath: 'x' },
      { id: 'b', topic: '/b', messageType: 'T', fieldPath: 'x', enabled: false },
    ],
  });
  const data = new Map([
    [
      'a',
      [
        { time: 0, value: 1000 },
        { time: 2000, value: 1 },
      ],
    ],
    ['b', [{ time: 2000, value: 999 }]],
  ]);
  expect(liveView(data, config)).toEqual({ start: 1000, end: 2000, min: 0, max: 2 });
  expect(liveView(data, { ...config, autoScale: false, minY: -5, maxY: 5 }).min).toBe(-5);
});
