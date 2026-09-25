import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecordReplayPanel from './RecordReplayPanel';
import { ReplaySession } from './ReplaySession';
import type { BagInfo, ReaderRequest, ReaderResponse, RecorderStatus } from './types';

const recorder = vi.hoisted(() => ({
  value: {
    status: undefined as RecorderStatus | undefined,
    online: false,
    pending: false,
    error: '',
    folders: undefined as { directory: string; folders: string[]; recordings: string[] } | undefined,
    command: vi.fn(),
  },
}));
vi.mock('./useRecorder', () => ({ useRecorder: () => recorder.value }));

const START = 1_000n * 1_000_000_000n;
const INFO: BagInfo = {
  name: 'field_test.mcap', size: 3 * 1024 ** 2, start: START, end: START + 60n * 1_000_000_000n,
  topics: [
    { name: '/odom', type: 'nav_msgs/msg/Odometry', count: 1200 },
    { name: '/custom', type: 'x/Y', count: 3, error: 'Unsupported encoding' },
  ],
};
const recorderStatus = (patch: Partial<RecorderStatus>): RecorderStatus => ({
  version: 1, state: 'idle', root: '/recordings', path: '', messages: 0, bytes: 0, dropped: 0, elapsed: 0, topics: [], ...patch,
});

class FakeWorker {
  requests: ReaderRequest[] = [];
  onmessage: ((event: MessageEvent<ReaderResponse>) => void) | null = null;
  onerror = null;
  postMessage(request: ReaderRequest) { this.requests.push(request); }
  terminate() {}
  reply(response: ReaderResponse) { act(() => this.onmessage?.({ data: response } as MessageEvent<ReaderResponse>)); }
  last(op: ReaderRequest['op']) { return [...this.requests].reverse().find(request => request.op === op)!; }
}

let worker: FakeWorker;
let session: ReplaySession;
const onStateChange = vi.fn();
const ros = { getTopics: (callback: (result: { topics: string[] }) => void) => callback({ topics: ['/scan', '/odom', '/roboboy/recorder/status'] }) } as unknown as Ros;
const renderPanel = (props: Partial<Parameters<typeof RecordReplayPanel>[0]> = {}) =>
  render(<RecordReplayPanel session={session} ros={ros} connected isActive onStateChange={onStateChange} {...props} />);
const drop = (name: string) => {
  const file = new File(['x'], name);
  const panel = screen.getByRole('region', { name: 'Record & Replay' });
  fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'], files: [file] } });
  expect(screen.getByText('Drop to replay')).toBeInTheDocument();
  fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file] } });
};
const openBag = () => {
  drop('field_test.mcap');
  worker.reply({ id: worker.last('open').id, op: 'opened', info: INFO });
  worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
};

beforeEach(() => {
  vi.useFakeTimers();
  worker = new FakeWorker();
  session = new ReplaySession(() => worker as unknown as Worker);
  onStateChange.mockClear();
  recorder.value = { status: undefined, online: false, pending: false, error: '', folders: undefined, command: vi.fn() };
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
});

describe('RecordReplayPanel replay', () => {
  it('invites a drop and reports files that are not MCAP', () => {
    renderPanel();
    expect(screen.getByText('Drop an MCAP here')).toBeInTheDocument();
    drop('notes.txt');
    expect(screen.queryByText('Drop to replay')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an .mcap recording.');
    expect(screen.getByRole('button', { name: 'Choose another MCAP' })).toBeInTheDocument();
  });

  it('shows the loading state, then the recording and its topics', () => {
    renderPanel();
    drop('field_test.mcap');
    expect(screen.getByText('Unpacking your recording…')).toBeInTheDocument();
    worker.reply({ id: worker.last('open').id, op: 'opened', info: INFO });
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
    expect(screen.getByText('field_test.mcap')).toBeInTheDocument();
    expect(screen.getByText('3.0 MiB · 2 topics · Local replay')).toBeInTheDocument();
    expect(screen.getByLabelText('Playback position', { selector: 'output' })).toHaveTextContent('00:00');
    expect(screen.getByText('01:00')).toBeInTheDocument();
    expect(screen.getByText('Unsupported encoding')).toBeInTheDocument();
  });

  it('drives playback from the transport controls', () => {
    renderPanel();
    openBag();
    const seek = vi.spyOn(session, 'seek');
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    expect(session.getSnapshot().playing).toBe(true);
    expect(screen.getByRole('button', { name: 'Pause playback' })).toHaveClass('is-playing');
    fireEvent.click(screen.getByRole('button', { name: 'Pause playback' }));
    expect(session.getSnapshot().playing).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(seek).toHaveBeenLastCalledWith(10);
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(seek).toHaveBeenLastCalledWith(0);

    fireEvent.click(screen.getByRole('button', { name: 'Loop recording' }));
    expect(screen.getByRole('button', { name: 'Loop recording' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('debounces scrubbing into one seek', () => {
    renderPanel();
    openBag();
    const seek = vi.spyOn(session, 'seek');
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.change(slider, { target: { value: '12' } });
    fireEvent.change(slider, { target: { value: '15' } });
    expect(screen.getByLabelText('Playback position', { selector: 'output' })).toHaveTextContent('00:15');
    expect(seek).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(15);
  });

  it('picks a speed from the popover and closes it on Escape or outside clicks', () => {
    renderPanel();
    openBag();
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1×' }));
    const menu = screen.getByRole('group', { name: 'Playback speed' });
    expect(within(menu).getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(menu).getByRole('button', { name: '4×' }));
    expect(session.getSnapshot().speed).toBe(4);
    expect(screen.queryByRole('group', { name: 'Playback speed' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 4×' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Playback speed' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 4×' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Playback speed' })).not.toBeInTheDocument();
  });

  it('returns to live data when the recording is closed', () => {
    renderPanel();
    openBag();
    fireEvent.click(screen.getByRole('button', { name: 'Close recording and return to live data' }));
    expect(screen.getByText('Drop an MCAP here')).toBeInTheDocument();
    expect(session.getSource().ros).toBeNull();
  });

  it('opens a recording from the file picker', () => {
    renderPanel();
    const input = screen.getByLabelText('Open MCAP recording') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'picked.mcap')] } });
    expect(worker.last('open')).toMatchObject({ file: { name: 'picked.mcap' } });
  });
});

describe('RecordReplayPanel record', () => {
  const openRecord = () => fireEvent.click(screen.getByRole('button', { name: 'Record' }));

  it('explains what recording needs', () => {
    const { unmount } = renderPanel({ connected: false, ros: null });
    openRecord();
    expect(screen.getByText('Connect to ROS to record')).toBeInTheDocument();
    expect(screen.queryByText(/needs the Robo-Boy recording service/)).not.toBeInTheDocument();
    unmount();
    renderPanel();
    openRecord();
    expect(screen.getAllByText('Waiting for the ROS recorder…')).toHaveLength(1);
    expect(screen.getByText(/needs the Robo-Boy recording service/)).toBeInTheDocument();
  });

  it('restores saved options, saves edits and starts with the chosen topics', () => {
    recorder.value = { ...recorder.value, online: true, status: recorderStatus({}) };
    renderPanel({ state: { version: 1, options: { name: 'saved_run', frequency: 5, allTopics: true, compression: 'bogus', qos: 'reliable', topics: ['/odom', 3] } } });
    openRecord();
    expect(screen.getByText('Ready to record')).toBeInTheDocument();
    expect(screen.getByLabelText('Recording name')).toHaveValue('saved_run');
    expect(screen.getByLabelText(/Maximum Hz per topic/)).toHaveValue(5);
    expect(screen.getByLabelText('Compression')).toHaveValue('zstd');

    fireEvent.change(screen.getByLabelText('Recording name'), { target: { value: 'run_2' } });
    expect(onStateChange).toHaveBeenLastCalledWith({ version: 1, options: expect.objectContaining({ name: 'run_2' }) });
    fireEvent.click(screen.getByLabelText('All topics, including newly discovered topics'));
    expect(screen.queryByText('/roboboy/recorder/status')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter recording topics'), { target: { value: 'sc' } });
    fireEvent.click(screen.getByLabelText('/scan'));
    fireEvent.change(screen.getByLabelText('Filter recording topics'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('/odom'));

    fireEvent.change(screen.getByLabelText('Exclude topics matching'), { target: { value: '/camera/' } });
    fireEvent.change(screen.getByLabelText('Split size (MiB)'), { target: { value: '512' } });
    fireEvent.click(screen.getByLabelText('Use simulation time from /clock'));
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(recorder.value.command).toHaveBeenCalledWith('start', expect.objectContaining({
      name: 'run_2', allTopics: false, topics: ['/scan'], exclude: '/camera/', maxSizeMiB: 512, useSimTime: true, qos: 'reliable',
    }));
  });

  it('browses folders on the ROS host without entering existing recordings', () => {
    recorder.value = { ...recorder.value, online: true, status: recorderStatus({}), folders: { directory: 'robots', folders: ['day1'], recordings: ['run_a'] } };
    renderPanel();
    openRecord();
    fireEvent.click(screen.getByRole('button', { name: 'Browse recording folders' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('folders', undefined, '');
    expect(screen.getByText('/recordings/robots')).toBeInTheDocument();
    expect(screen.getByTitle('Existing recording')).toHaveTextContent('run_a');
    fireEvent.click(screen.getByRole('button', { name: 'day1' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('folders', undefined, 'robots/day1');
    fireEvent.click(screen.getByRole('button', { name: 'Parent folder' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('folders', undefined, '');
    fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ version: 1, options: expect.objectContaining({ path: 'robots' }) });
  });

  it('controls a running recording and offers a fresh name once it is saved', () => {
    recorder.value = { ...recorder.value, online: true, status: recorderStatus({ state: 'recording', path: '/recordings/run_9', messages: 1500, bytes: 2048, dropped: 3, elapsed: 65 }) };
    const { rerender } = renderPanel({ state: { version: 1, options: { name: 'run_9' } } });
    openRecord();
    expect(screen.getByText('Recording in progress')).toBeInTheDocument();
    expect(screen.getByText('01:05 · 1,500 messages · 2 KiB payload')).toBeInTheDocument();
    expect(screen.getByText('3 messages dropped: writer queue full.')).toBeInTheDocument();
    expect(screen.getByLabelText('Recording name')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('pause');
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('split');
    fireEvent.click(screen.getByRole('button', { name: 'Stop & save' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('stop');

    recorder.value = { ...recorder.value, status: recorderStatus({ state: 'paused', path: '/recordings/run_9' }) };
    rerender(<RecordReplayPanel session={session} ros={ros} connected isActive onStateChange={onStateChange} state={{ version: 1, options: { name: 'run_9' } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(recorder.value.command).toHaveBeenLastCalledWith('resume');

    recorder.value = { ...recorder.value, status: recorderStatus({ state: 'idle', path: '/recordings/run_9' }), error: 'Disk full' };
    rerender(<RecordReplayPanel session={session} ros={ros} connected isActive onStateChange={onStateChange} state={{ version: 1, options: { name: 'run_9' } }} />);
    expect(screen.getByLabelText('Recording name')).not.toHaveValue('run_9');
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
  });
});
