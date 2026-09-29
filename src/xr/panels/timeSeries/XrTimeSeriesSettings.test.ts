import type { Ros } from 'roslib';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { getDesiredSources, sanitizeConfig } from '../../../features/timeSeries/config';
import { TimeSeriesEngine } from '../../../features/timeSeries/engine';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { stubCanvasContext } from '../../ui/canvasStub';
import { XrTimeSeriesSettings } from './XrTimeSeriesSettings';

beforeAll(stubCanvasContext);
afterEach(() => vi.useRealTimers());

it('discovers topics, expands numeric fields through the shared engine, and edits the selected signal', () => {
  const engine = new TimeSeriesEngine(sanitizeConfig(null));
  const configure = vi.fn(config => engine.configure(config));
  const ros = { getTopics: vi.fn(done => done({ topics: ['/velocity'], types: ['Twist'] })) } as unknown as Ros;
  const menu = new SpatialMenu();
  const settings = new XrTimeSeriesSettings(
    menu,
    { engine, ros, configure, connected: true, error: '', setPresented: vi.fn() },
    () => engine.clear()
  );
  const press = (id: string) => {
    const item = menu.surface.getItem(id);
    expect(item?.disabled).not.toBe(true);
    item?.onPress?.();
  };
  settings.open();
  press('row-0'); // add topic
  press('row-1'); // /velocity
  expect(engine.config.series).toMatchObject([{ topic: '/velocity', fieldPath: '' }]);
  engine.receive(getDesiredSources(engine.config)[0], { linear: { x: 1, y: 2 } }, 1000);
  expect(engine.config.series.map(s => s.fieldPath)).toEqual(['linear.x', 'linear.y']);
  press('row-1'); // signals
  press('row-0'); // first signal
  press('row-2'); // smoothing
  expect(engine.config.series[0].filter).toEqual({ type: 'movingAverage', window: 10 });
  press('row-3:inc');
  expect(engine.config.series[0].filter).toEqual({ type: 'movingAverage', window: 11 });
  settings.dispose();
  menu.dispose();
});

it('expires topic discovery and ignores late responses after disposal', () => {
  vi.useFakeTimers();
  let complete: (result: { topics: string[]; types: string[] }) => void = () => {};
  const ros = {
    getTopics: vi.fn(done => {
      complete = done;
    }),
  } as unknown as Ros;
  const menu = new SpatialMenu();
  const settings = new XrTimeSeriesSettings(
    menu,
    {
      engine: new TimeSeriesEngine(sanitizeConfig(null)),
      ros,
      connected: true,
      error: '',
      configure: vi.fn(),
      setPresented: vi.fn(),
    },
    vi.fn()
  );
  settings.open();
  menu.surface.getItem('row-0')?.onPress?.();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(8000);
  const refresh = vi.spyOn(menu, 'refresh');
  complete({ topics: ['/late'], types: ['T'] });
  expect(refresh).not.toHaveBeenCalled();
  menu.surface.getItem('row-0')?.onPress?.(); // retry
  expect(vi.getTimerCount()).toBe(1);
  settings.dispose();
  expect(vi.getTimerCount()).toBe(0);
  refresh.mockClear();
  complete({ topics: ['/late'], types: ['T'] });
  expect(refresh).not.toHaveBeenCalled();
  menu.dispose();
});
