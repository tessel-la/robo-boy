import { describe, expect, it } from 'vitest';
import { DEFAULT_VISUALIZATION_STATE } from '../../utils/visualizationState';
import { recordValuesFor, timeSeriesValuesFor, visualizationStateFor } from './openTarget';
import type { ExplorerOpenRequest } from './DataExplorerPanel';

const request = (patch: Partial<ExplorerOpenRequest>): ExplorerOpenRequest => ({
  panel: 'timeSeries',
  topic: '/speed',
  messageType: 'std_msgs/msg/Float64',
  ...patch,
});
const topicsOf = (values: ReturnType<typeof recordValuesFor>) =>
  (values.options as unknown as { topics: string[]; allTopics: boolean }).topics;

describe('opening a topic in another panel', () => {
  it('adds a plotted line to an open Time Series and keeps its other lines and settings', () => {
    const first = timeSeriesValuesFor(undefined, request({ fieldPath: 'data' }));
    const config = first.config as unknown as { series: { topic: string; fieldPath: string }[] };
    expect(config.series.map(series => `${series.topic}:${series.fieldPath}`)).toEqual(['/speed:data']);

    const kept = { config: { ...(first.config as object), timeWindowSec: 42 } } as never;
    const second = timeSeriesValuesFor(kept, request({ topic: '/odom', fieldPath: 'twist.linear.x' }));
    const merged = second.config as unknown as { series: { topic: string }[]; timeWindowSec: number };
    expect(merged.series.map(series => series.topic)).toEqual(['/speed', '/odom']);
    expect(merged.timeWindowSec).toBe(42);

    // Plotting the same field again does not add a second line.
    const again = timeSeriesValuesFor(second, request({ topic: '/odom', fieldPath: 'twist.linear.x' }));
    expect((again.config as unknown as { series: unknown[] }).series).toHaveLength(2);
  });

  it('adds recorded topics to the chosen ones and keeps the other record options', () => {
    const first = recordValuesFor(undefined, request({ panel: 'recordReplay', topic: '/scan' }));
    expect(first).toMatchObject({ version: 1, initialTab: 'record' });
    expect(topicsOf(first)).toEqual(['/scan']);

    const previous = {
      version: 1,
      options: { ...(first.options as object), compression: 'none' },
    } as never;
    const second = recordValuesFor(previous, request({ panel: 'recordReplay', topic: '/a', topics: ['/a', '/scan'] }));
    expect(topicsOf(second)).toEqual(['/scan', '/a']);
    expect((second.options as unknown as { compression: string }).compression).toBe('none');
  });

  it('replaces "all topics" by the requested ones and ignores malformed saved options', () => {
    const all = { options: { allTopics: true, topics: ['/old'] } } as never;
    expect(topicsOf(recordValuesFor(all, request({ panel: 'recordReplay', topic: '/scan' })))).toEqual(['/scan']);
    const broken = { options: ['not', 'an', 'object'] } as never;
    expect(topicsOf(recordValuesFor(broken, request({ panel: 'recordReplay', topic: '/scan' })))).toEqual(['/scan']);
  });

  it('adds a 3D layer once and keeps existing layers and frame settings', () => {
    let next = 0;
    const createId = () => `layer-${++next}`;
    const scan = request({ panel: '3d', topic: '/scan', visualizationType: 'laserscan' });
    const current = {
      ...DEFAULT_VISUALIZATION_STATE,
      fixedFrame: 'odom',
      visualizations: [{ id: 'kept', type: 'pointcloud', topic: '/cloud' }],
    };
    const added = visualizationStateFor(current, scan, createId);
    expect(added.fixedFrame).toBe('odom');
    expect(added.visualizations).toEqual([
      { id: 'kept', type: 'pointcloud', topic: '/cloud' },
      { id: 'layer-1', type: 'laserscan', topic: '/scan' },
    ]);
    expect(visualizationStateFor(added, scan, createId)).toBe(added);
    expect(visualizationStateFor(added, request({ panel: '3d', topic: '/x' }), createId)).toBe(added);
  });
});
