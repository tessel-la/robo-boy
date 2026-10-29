import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { sanitizeConfig, sourceKey, type TimeseriesConfig } from './config';
import { TimeSeriesEngine } from './engine';
import TimeSeriesPlot from './TimeSeriesPlot';
import TimeSeriesSettings from './TimeSeriesSettings';
import NumberSetting from './NumberSetting';

let frames: Map<number, FrameRequestCallback>,
  next: number,
  frameTime = 0;
const source = { key: sourceKey('/pose', 'Pose'), topic: '/pose', messageType: 'Pose', throttleMs: 0 };
const initial = () =>
  sanitizeConfig({
    schemaVersion: 4,
    series: [
      { id: 'x', topic: '/pose', messageType: 'Pose', fieldPath: 'x', label: 'X', unit: 'm' },
      { id: 'y', topic: '/pose', messageType: 'Pose', fieldPath: 'y', label: 'Y', unit: 'm' },
    ],
  });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const tick = () =>
  act(() => {
    const entry = frames.entries().next().value!;
    frames.delete(entry[0]);
    entry[1]((frameTime += 1000));
  });
function setup(extra: Partial<TimeseriesConfig> = {}) {
  const engine = new TimeSeriesEngine({ ...initial(), ...extra });
  for (let i = 0; i < 3; i++) engine.receive(source, { x: i + 1, y: (i + 1) * 2 }, i * 1000);
  const changed = vi.fn();
  function Harness() {
    const [config, setConfig] = useState(engine.config);
    return (
      <TimeSeriesPlot
        engine={engine}
        config={config}
        active
        onOpenSettings={vi.fn()}
        onToggle={vi.fn()}
        onChange={value => {
          changed(value);
          engine.configure(value);
          setConfig(value);
        }}
      />
    );
  }
  const view = render(<Harness />);
  tick();
  return { engine, changed, view };
}
beforeEach(() => {
  frames = new Map();
  next = 1;
  frameTime = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = next++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 500,
    height: 300,
    top: 0,
    left: 0,
  } as DOMRect);
  const context = new Proxy({}, { get: () => vi.fn(), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('switches the existing plot to XY, requires an X choice and exports paired coordinates with panel-clock times', async () => {
  const { changed, view } = setup();
  click('More');
  fireEvent.change(screen.getByLabelText('Plot mode'), { target: { value: 'xy' } });
  tick();
  expect(screen.getByText('Choose an X signal above, then add or show a Y signal.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('X signal'), { target: { value: 'x' } });
  tick();
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'xy', xSeriesId: 'x' }));
  expect(screen.getByLabelText('Visible plot range')).toHaveTextContent(/^X/);
  expect(screen.getByText('3 samples')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Y' })).toBeInTheDocument();
  click('More');
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:plot');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  click('More');
  click('Export CSV');
  const blob: Blob = createObjectURL.mock.calls[0][0];
  const text = await new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(text).toBe('series,time_ms,x,y\n"Y",0,1,2\n"Y",1000,2,4\n"Y",2000,3,6');
  view.unmount();
  expect(frames.size).toBe(0);
});

it('analyzes a frozen capture, edits its interval, handles invalid bounds and restores focus on close', () => {
  const { engine } = setup();
  click('More');
  click('Interval statistics');
  const region = screen.getByRole('region', { name: 'Interval statistics' });
  expect(within(region).getByRole('button', { name: 'Close interval statistics' })).toHaveFocus();
  const row = () => within(region).getByRole('row', { name: /^Y \(m\)/ });
  expect(
    within(row())
      .getAllByRole('cell')
      .map(cell => cell.textContent)
      .slice(0, 4)
  ).toEqual(['3', '2', '6', '4']);
  act(() => engine.receive(source, { x: 100, y: 200 }, 3000));
  tick();
  expect(within(row()).getAllByRole('cell')[0]).toHaveTextContent('3');
  fireEvent.change(within(region).getByLabelText('Start (s)'), { target: { value: '1' } });
  fireEvent.blur(within(region).getByLabelText('Start (s)'));
  expect(
    within(row())
      .getAllByRole('cell')
      .slice(0, 4)
      .map(cell => cell.textContent)
  ).toEqual(['2', '4', '6', '5']);
  fireEvent.change(within(region).getByLabelText('End (s)'), { target: { value: '0' } });
  fireEvent.blur(within(region).getByLabelText('End (s)'));
  expect(within(region).getByRole('alert')).toHaveTextContent('End must be at or after start');
  fireEvent.keyDown(region, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Interval statistics' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
  click('Reset / Live');
  tick();
  expect(screen.getByText('8 samples')).toBeInTheDocument();
});

it('configures explicit XY pairing and trajectory/scatter using the existing settings owner', () => {
  const onChange = vi.fn(),
    config: TimeseriesConfig = { ...initial(), mode: 'xy', xSeriesId: 'x' };
  const engine = new TimeSeriesEngine(config);
  const props = { config, engine, ros: null, connected: false, onChange, onClose: vi.fn() };
  const view = render(<TimeSeriesSettings {...props} />);
  fireEvent.change(screen.getByLabelText('XY pairing'), { target: { value: 'latest' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ xyPairing: 'latest' }));
  view.rerender(<TimeSeriesSettings {...props} config={{ ...config, xyPairing: 'latest' }} />);
  const age = screen.getByLabelText('Maximum X age (ms)');
  fireEvent.change(age, { target: { value: '50' } });
  fireEvent.blur(age);
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ xyToleranceMs: 50 }));
  fireEvent.change(screen.getByLabelText('XY display'), { target: { value: 'scatter' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ xyStyle: 'scatter' }));
  fireEvent.change(screen.getByLabelText('X signal'), { target: { value: 'y' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ xSeriesId: 'y' }));
});

it('renders scatter points, inspects the nearest XY pair and zooms in numeric coordinates', () => {
  setup({ mode: 'xy', xSeriesId: 'x', xyStyle: 'scatter' });
  const canvas = screen.getByRole('img');
  fireEvent(canvas, new MouseEvent('pointermove', { clientX: 150, clientY: 140 }));
  tick();
  expect(screen.getByText(/nearest paired samples/)).toBeInTheDocument();
  const previous = screen.getByLabelText('Visible plot range').textContent;
  click('More');
  click('Zoom in');
  expect(screen.getByLabelText('Visible plot range').textContent).not.toBe(previous);
  click('More');
  click('Clear data');
  tick();
  expect(screen.getByText(/Waiting for paired numeric samples/)).toBeInTheDocument();
});

it('commits fractional interval values on Enter and restores an invalid number on blur', () => {
  const onChange = vi.fn();
  render(<NumberSetting label="Interval" value={0.02} onChange={onChange} />);
  const input = screen.getByLabelText('Interval');
  input.focus();
  fireEvent.change(input, { target: { value: '0.001' } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith(0.001);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(input).toHaveValue(0.02);
  expect(onChange).toHaveBeenCalledOnce();
});
