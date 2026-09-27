import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import type { RoboBoyJsonObject } from '../../panels/types';
import TimeSeriesPanel from './TimeSeriesPanel';
import { sanitizeConfig } from './config';
import type { TimeSeriesEngine } from './engine';
import type { PanelSettingsBridge } from '../assistant/types';
const mocks = vi.hoisted(() => ({
  topics: [] as Array<{ name: string; listener?: (m: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }>,
  engine: null as TimeSeriesEngine | null,
}));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      name: string;
      callForSubscribeAndAdvertise = vi.fn();
      listener?: (m: unknown) => void;
      unsubscribe = vi.fn();
      constructor(options: { name: string }) {
        this.name = options.name;
        mocks.topics.push(this);
      }
      subscribe(listener: (m: unknown) => void) {
        this.listener = listener;
      }
    },
  },
}));
vi.mock('./TimeSeriesPlot', () => ({
  default: ({ engine, onToggle }: { engine: TimeSeriesEngine; onToggle: (id: string) => void }) => {
    mocks.engine = engine;
    return <button onClick={() => onToggle('a')}>Toggle signal</button>;
  },
}));
const cfg = () =>
  sanitizeConfig({
    schemaVersion: 3,
    series: [
      { id: 'a', topic: '/a', messageType: 'T', fieldPath: 'x' },
      { id: 'b', topic: '/a', messageType: 'T', fieldPath: 'y' },
    ],
  });
const props = () => ({
  ros: { getTopics: vi.fn() } as unknown as Ros,
  connected: true,
  connectionGeneration: 1,
  isActive: true,
  state: { config: cfg() } as unknown as RoboBoyJsonObject,
  onStateChange: vi.fn(),
});
beforeEach(() => {
  mocks.topics.length = 0;
});
it('deduplicates subscriptions, ignores late callbacks, and cleans up inactive/unmounted/reconnected tiles', async () => {
  const p = props(),
    { rerender, unmount } = render(<TimeSeriesPanel {...p} />);
  await act(async () => {});
  expect(mocks.topics).toHaveLength(1);
  act(() => mocks.topics[0].listener?.({ x: 1, y: 2 }));
  expect(mocks.engine!.runtime.get('a')!.buffer.size).toBe(1);
  rerender(<TimeSeriesPanel {...p} connectionGeneration={2} />);
  await act(async () => {});
  expect(mocks.topics).toHaveLength(2);
  expect(mocks.topics[0].unsubscribe).toHaveBeenCalledOnce();
  act(() => mocks.topics[0].listener?.({ x: 5 }));
  expect(mocks.engine!.runtime.get('a')!.buffer.size).toBe(1);
  rerender(<TimeSeriesPanel {...p} isActive={false} connectionGeneration={2} />);
  await act(async () => {});
  expect(mocks.topics[1].unsubscribe).toHaveBeenCalledOnce();
  rerender(<TimeSeriesPanel {...p} connectionGeneration={2} />);
  await act(async () => {});
  unmount();
  await act(async () => {});
  expect(mocks.topics[2].unsubscribe).toHaveBeenCalledOnce();
});
it('saves visibility without losing config and restores a changed layout on the same mounted tile', async () => {
  const p = props(),
    { rerender } = render(<TimeSeriesPanel {...p} />);
  fireEvent.click(screen.getByText('Toggle signal'));
  expect(p.onStateChange.mock.lastCall?.[0].config.series[0]).toMatchObject({ enabled: false, fieldPath: 'x' });
  const next = cfg();
  next.series[0].math.scale = 3;
  rerender(<TimeSeriesPanel {...p} state={{ config: next } as unknown as RoboBoyJsonObject} />);
  await waitFor(() => expect(mocks.engine!.config.series[0].math.scale).toBe(3));
  expect(mocks.topics).toHaveLength(1);
});
it('lets the assistant read and change the plot through its settings bridge', async () => {
  const p = props();
  (p.ros.getTopics as ReturnType<typeof vi.fn>).mockImplementation((done: (result: { topics: string[]; types: string[] }) => void) =>
    done({ topics: ['/a', '/b'], types: ['T', 'U'] })
  );
  const register = vi.fn();
  const { unmount } = render(<TimeSeriesPanel {...p} panelId="plot-1" onRegisterAssistantBridge={register} />);
  await act(async () => {});
  const bridge = register.mock.lastCall?.[1] as PanelSettingsBridge;
  expect(register.mock.lastCall?.[0]).toBe('plot-1');
  expect(bridge.panelType).toBe('timeSeries');
  expect(bridge.settingsHelp).toContain('addSignals');
  expect(bridge.describe()).toMatchObject({ timeWindowSec: 15, signals: [{ id: 'a' }, { id: 'b' }] });

  let outcomes: ReturnType<PanelSettingsBridge['apply']> = [];
  act(() => {
    outcomes = bridge.apply({ addSignals: [{ topic: '/b', fieldPath: 'value', label: 'B²', math: { expression: 'x^2' } }], timeWindowSec: 60, paused: true });
  });
  expect(outcomes.every(outcome => outcome.ok)).toBe(true);
  expect(p.onStateChange.mock.lastCall?.[0].config).toMatchObject({ timeWindowSec: 60, series: [{ id: 'a' }, { id: 'b' }, { topic: '/b', messageType: 'U', label: 'B²' }] });
  expect(mocks.engine!.paused).toBe(true);
  await act(async () => {});
  expect(mocks.topics.map(topic => topic.name)).toEqual(['/a', '/b']);

  act(() => { bridge.apply({ clear: true }); });
  unmount();
  expect(register).toHaveBeenLastCalledWith('plot-1', null);
});
