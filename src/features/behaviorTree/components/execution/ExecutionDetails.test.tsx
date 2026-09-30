import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutionDetailsCard, { progressFields } from './ExecutionDetailsCard';
import ExecutionChip from './ExecutionChip';
import ValueInspector, { INSPECTOR_LIMITS } from './ValueInspector';
import { ExecutionDetailsContext } from '../../execution/executionContext';
import { ExecutionDetailsStore } from '../../execution/executionStore';
import { applyExecutionUpdate, type ExecutionRecord, type ExecutionUpdate } from '../../execution/executionModel';
import { bytesToBase64 } from '../../execution/richValues';

const JPEG = `/9j/4AAQSkZJRgABAQAAAQABAAD${'A'.repeat(200)}`;

const record = (...updates: Array<Partial<ExecutionUpdate>>): ExecutionRecord => updates.reduce<ExecutionRecord | undefined>(
  (previous, update, index) => applyExecutionUpdate(previous, 'node', [], {
    attemptId: 'attempt',
    kind: 'action',
    target: '/camera/capture',
    rosType: 'robot_msgs/action/Capture',
    phase: 'running',
    begin: index === 0,
    at: 1_000 + index * 500,
    ...update,
  }),
  undefined
)!;

describe('execution details', () => {
  beforeEach(() => {
    // jsdom has no canvas: a raw image is "drawn" into a recognisable data URL.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ putImageData: vi.fn() }) as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      return `data:image/png;base64,drawn-${this.width}x${this.height}`;
    });
    vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows an action\'s text result and how long it took', () => {
    render(<ExecutionDetailsCard nodeLabel="Say hello" onClose={vi.fn()} record={record({}, { phase: 'succeeded', goalStatus: 4, result: 'Hello from the robot' })} />);
    const card = screen.getByRole('dialog', { name: 'Say hello execution details' });
    expect(card).toHaveTextContent('Action · Succeeded');
    expect(card).toHaveTextContent('Succeeded (4)');
    expect(card).toHaveTextContent('500 ms');
    expect(within(card).getByRole('region', { name: 'Result' })).toHaveTextContent('Hello from the robot');
  });

  it('shows a service\'s plain values and an empty response', () => {
    const { rerender } = render(
      <ExecutionDetailsCard nodeLabel="Count" onClose={vi.fn()} record={record({ kind: 'service' }, { kind: 'service', phase: 'succeeded', result: { count: 3, ready: true, name: '' } })} />
    );
    const response = screen.getByRole('region', { name: 'Response' });
    expect(response).toHaveTextContent('count:3');
    expect(response).toHaveTextContent('ready:true');
    expect(response).toHaveTextContent('name:empty text');
    expect(screen.getByRole('dialog')).toHaveTextContent('Service · Responded');

    rerender(<ExecutionDetailsCard nodeLabel="Count" onClose={vi.fn()} record={record({ kind: 'service' }, { kind: 'service', phase: 'succeeded', result: {} })} />);
    expect(screen.getByRole('region', { name: 'Response' })).toHaveTextContent('No response fields');
  });

  it('lays out nested messages and arrays as a tree that opens and closes', () => {
    render(<ValueInspector value={{
      pose: { position: { x: 1.5, y: -2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      covariance: [0.1, 0, 0, 0.1],
      detections: [{ label: 'crate', box: { x: 10, y: 20, width: 30, height: 40, depth: 50 } }],
    }} />);
    expect(screen.getByText('[0.1, 0, 0, 0.1]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pose.*\{2 fields\}/ })).toHaveAttribute('aria-expanded', 'true');
    // Small messages of plain values open by themselves; bigger ones deeper down wait to be opened.
    expect(screen.getByText('1.5')).toBeInTheDocument();
    const detection = screen.getByRole('button', { name: /^0:.*\{2 fields\}/ });
    expect(detection).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(detection);
    const box = screen.getByRole('button', { name: /box.*\{5 fields\}/ });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pose/ }));
    expect(screen.queryByText('1.5')).not.toBeInTheDocument();
  });

  it('explains a failed action with its diagnostics', () => {
    render(<ExecutionDetailsCard nodeLabel="Capture" onClose={vi.fn()} record={record({}, {
      phase: 'failed',
      goalStatus: 6,
      result: { error_code: 104, error_msg: 'Lens cover closed', diagnostics: { temperature: 71.5 } },
      error: { message: 'Lens cover closed', code: 104, source: 'ros' },
    })} />);
    const problem = screen.getByRole('region', { name: 'What went wrong' });
    expect(problem).toHaveTextContent('Lens cover closed');
    expect(problem).toHaveTextContent('Reported by ROS');
    expect(problem).toHaveTextContent('Code 104');
    expect(screen.getByRole('dialog')).toHaveTextContent('Action · Aborted');
    expect(screen.getByRole('dialog')).toHaveTextContent('Aborted (6)');
    expect(screen.getByRole('region', { name: 'Result' })).toHaveTextContent('temperature:71.5');
  });

  it('explains a failed service call, and one that answered with its own failure', () => {
    const { rerender } = render(<ExecutionDetailsCard nodeLabel="Snapshot" onClose={vi.fn()} record={record({ kind: 'service' }, {
      kind: 'service', phase: 'failed', error: { message: 'Service /camera/snapshot does not exist', source: 'ros' },
    })} />);
    expect(screen.getByRole('region', { name: 'What went wrong' })).toHaveTextContent('Service /camera/snapshot does not exist');
    expect(screen.getByRole('dialog')).toHaveTextContent('Service · Call failed');

    rerender(<ExecutionDetailsCard nodeLabel="Snapshot" onClose={vi.fn()} record={record({ kind: 'service' }, {
      kind: 'service', phase: 'succeeded', result: { success: false, message: 'Camera busy' },
    })} />);
    const warning = screen.getByRole('region', { name: 'Reported failure' });
    expect(warning).toHaveTextContent('The service reported a failure');
    expect(warning).toHaveTextContent('Camera busy');
  });

  it('previews an image an action returned, and enlarges it', () => {
    render(<ExecutionDetailsCard nodeLabel="Capture" onClose={vi.fn()} record={record({}, {
      phase: 'succeeded', goalStatus: 4, result: { image: { header: { frame_id: 'camera' }, format: 'jpeg', data: JPEG }, exposure_ms: 12 },
    })} />);
    const thumbnail = screen.getByRole('img', { name: 'image' });
    expect(thumbnail).toHaveAttribute('src', `data:image/jpeg;base64,${JPEG}`);
    expect(screen.getByText(/^jpeg · /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge image' }));
    const lightbox = screen.getByRole('dialog', { name: 'image' });
    expect(within(lightbox).getByRole('link', { name: 'Save image' })).toHaveAttribute('download', 'image.jpeg');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'image' })).not.toBeInTheDocument();
    // Escape closed the enlarged image first; the card is still there.
    expect(screen.getByRole('dialog', { name: 'Capture execution details' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
    expect(screen.getByText('camera')).toBeInTheDocument();
    // The pixels inside are summarised, not previewed a second time.
    expect(screen.getByText(/^Image data · jpeg/i)).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('decodes a sensor_msgs/Image a service returned', () => {
    const pixels = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    render(<ExecutionDetailsCard nodeLabel="Snapshot" onClose={vi.fn()} record={record({ kind: 'service' }, {
      kind: 'service', phase: 'succeeded', result: { success: true, frame: { height: 2, width: 2, encoding: 'rgb8', step: 6, is_bigendian: 0, data: bytesToBase64(pixels) } },
    })} />);
    expect(screen.getByRole('img', { name: 'frame' })).toHaveAttribute('src', 'data:image/png;base64,drawn-2x2');
    expect(screen.getByText('2×2 · rgb8')).toBeInTheDocument();
  });

  it('says why an image cannot be previewed', () => {
    render(<ValueInspector value={{ frame: { height: 1, width: 1, encoding: 'bayer_rggb8', data: 'AA==' } }} />);
    expect(screen.getByRole('note')).toHaveTextContent('The “bayer_rggb8” encoding cannot be previewed.');
  });

  it('shows the latest feedback of a running action, with its progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const running = record({}, { feedback: { progress: 0.4, stage: 'focusing' } }, { feedback: { progress: 0.8, stage: 'exposing' } });
    render(<ExecutionDetailsCard nodeLabel="Capture" onClose={vi.fn()} record={running} />);
    const feedback = screen.getByRole('region', { name: 'Feedback' });
    expect(feedback).toHaveTextContent('Latest of 2');
    expect(feedback).toHaveTextContent('exposing');
    expect(screen.getByRole('progressbar', { name: 'progress' })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByRole('dialog')).toHaveTextContent('Running · feedback received');
    expect(progressFields({ percentage: 45, eta: 3 })).toEqual([{ name: 'percentage', fraction: 0.45 }]);
    vi.useRealTimers();
  });

  it('keeps large and unexpected payloads within bounds', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ index }));
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { bottom: true };
    for (let level = 0; level < INSPECTOR_LIMITS.depth + 3; level += 1) deep = { level: deep };
    render(<ValueInspector value={{
      many,
      text: 'x'.repeat(1000),
      blob: bytesToBase64(Uint8Array.from({ length: 900 }, (_, i) => (i * 97 + 13) % 256)),
      cyclic,
      deep,
      odd: { fn: () => 1, big: BigInt(12), missing: undefined, nothing: null },
    }} />);

    // Top-level fields start open; the long list shows a page at a time.
    expect(screen.getAllByText(/^index:/)).toHaveLength(INSPECTOR_LIMITS.children);
    fireEvent.click(screen.getByRole('button', { name: 'Show 40 more of 60' }));
    expect(screen.getAllByText(/^index:/)).toHaveLength(80);
    const showAll = screen.getByRole('button', { name: 'Show all 1,000 characters' });
    const text = showAll.closest('.bt-value-string')!;
    expect(text.textContent).toMatch(new RegExp(`^x{${INSPECTOR_LIMITS.stringChars}}…Show all`));
    fireEvent.click(showAll);
    expect(text.textContent).toMatch(/^x{1000}Show less$/);
    expect(screen.getByText('Binary data · 900 B')).toBeInTheDocument();

    expect(screen.getByText('(repeats an outer value)')).toBeInTheDocument();
    expect(screen.getByText('big:').parentElement).toHaveTextContent('big:12');
    expect(screen.getByText('fn:').parentElement).toHaveTextContent(/^fn:\(\) => 1$/);
    expect(screen.getByText('missing:').parentElement).toHaveTextContent('missing:undefined');
    expect(screen.getByText('nothing:').parentElement).toHaveTextContent('nothing:null');

    const closedLevel = () => screen.queryAllByRole('button', { name: /^level/ }).find(item => item.getAttribute('aria-expanded') === 'false');
    for (let button = closedLevel(); button; button = closedLevel()) fireEvent.click(button);
    expect(screen.getByText(/nested too deep to show/)).toBeInTheDocument();
  });

  it('renders any top-level value safely', () => {
    const { rerender } = render(<ValueInspector value="Plain text result" label="result" />);
    expect(screen.getByText('Plain text result')).toBeInTheDocument();
    rerender(<ValueInspector value={42} label="result" />);
    expect(screen.getByText('42')).toBeInTheDocument();
    rerender(<ValueInspector value={[]} label="result" emptyText="Nothing" />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    rerender(<ValueInspector value={Symbol('odd')} label="result" />);
    expect(screen.getByText('Symbol(odd)')).toBeInTheDocument();
  });

  it('shows the chip only once there is something to open, and opens the node\'s details', () => {
    const store = new ExecutionDetailsStore();
    const open = vi.fn();
    const Wrapper = ({ openNodeId }: { openNodeId: string | null }) => (
      <ExecutionDetailsContext.Provider value={{ store, treePath: [], open, openNodeId }}>
        <div onClick={() => { throw new Error('the node must not receive the chip\'s click'); }}>
          <ExecutionChip nodeId="capture" nodeLabel="Capture" />
        </div>
      </ExecutionDetailsContext.Provider>
    );
    const { rerender } = render(<Wrapper openNodeId={null} />);
    const base = { attemptId: 'a', kind: 'action' as const, target: '/camera/capture' };
    act(() => store.apply('capture', [], { ...base, phase: 'running', begin: true }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    act(() => store.apply('capture', [], { ...base, phase: 'succeeded', result: { image: { format: 'jpeg', data: JPEG } } }));
    const chip = screen.getByRole('button', { name: 'Capture: Succeeded. Show execution details' });
    expect(chip).toHaveClass('tone-success', 'nodrag', 'nopan');
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith('capture');

    rerender(<Wrapper openNodeId="capture" />);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    act(() => store.clear());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when the open node has not run', () => {
    const onClose = vi.fn();
    render(<ExecutionDetailsCard nodeLabel="Capture" onClose={onClose} record={undefined} />);
    expect(screen.getByText('This node has not run since the tree was loaded or last started.')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
