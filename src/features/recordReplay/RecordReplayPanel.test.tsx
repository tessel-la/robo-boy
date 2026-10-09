import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rangeServer } from '../../test/rangeServer';
import RecordReplayPanel from './RecordReplayPanel';
import { ReplaySession } from './ReplaySession';
import type { BagInfo, ReaderRequest, ReaderResponse, RecorderStatus } from './types';
import type { PanelSettingsBridge } from '../assistant/types';

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

/** The ROS host's recordings, by folder. 'down' fails like an unreachable host; a folder not set here never answers. */
let listings: Record<string, unknown>;
const EMPTY = { version: 1, folders: [], files: [], recordings: [] };
const LISTING = {
  version: 1, directory: '.', folders: ['field'],
  files: [{ name: 'loose.mcap', path: 'loose.mcap', size: 2048, modified: 0 }],
  recordings: [
    { name: 'run_1', path: 'run_1', active: false, duration: 75, messages: 1200, files: [{ name: 'run_1_0.mcap', path: 'run_1/run_1_0.mcap', size: 3 * 1024 ** 2, modified: 0 }] },
    { name: 'live', path: 'live', active: true, files: [] },
    { name: 'long', path: 'long', active: false, files: [{ name: 'long_0.mcap', path: 'long/long_0.mcap', size: 1024, modified: 0 }, { name: 'long_1.mcap', path: 'long/long_1.mcap', size: 1024, modified: 0 }] },
  ],
};
const BAG_BYTES = Uint8Array.from({ length: 5000 }, (_, index) => index % 7);
let fetchMock: ReturnType<typeof vi.fn>;
const settle = async () => { for (let turn = 0; turn < 5; turn++) await act(async () => { await Promise.resolve(); }); };
const remoteUrl = (path: string) => `${location.origin}/recordings/files/${path}`;

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
  listings = {};
  const files = rangeServer(BAG_BYTES);
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, location.href);
    if (url.pathname.startsWith('/recordings/files/')) return files.fetch(input, init);
    const path = url.searchParams.get('path') ?? '';
    if (!(path in listings)) return new Promise(() => undefined);
    const listing = listings[path];
    if (listing === 'down') throw new TypeError('Failed to fetch');
    return { status: 200, ok: true, json: async () => listing };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup(); // Unmount first: a mounted panel reacts to its recording closing by listing the ROS host again.
  session.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    expect(worker.last('open')).toMatchObject({ source: { name: 'picked.mcap' } });
  });
});

describe('RecordReplayPanel recordings on the ROS host', () => {
  it('lists folders, bags and files, and replays one in place', async () => {
    listings[''] = LISTING;
    renderPanel();
    await settle();
    const host = screen.getByRole('region', { name: 'Recordings on the ROS host' });
    expect(within(host).getByRole('button', { name: 'field' })).toBeInTheDocument();
    expect(within(host).getByText('01:15 · 1,200 messages · 3.0 MiB')).toBeInTheDocument();
    expect(within(host).getByText('Being recorded · available when it stops')).toBeInTheDocument();
    expect(within(host).queryByRole('button', { name: /live/ })).not.toBeInTheDocument();
    expect(within(host).getByRole('list', { name: 'Parts of long' })).toHaveTextContent('Part 2 of 2');

    fireEvent.click(within(host).getByRole('button', { name: 'Replay run_1_0.mcap from the ROS host' }));
    expect(worker.last('open')).toMatchObject({ source: { url: remoteUrl('run_1/run_1_0.mcap'), name: 'run_1_0.mcap', size: 3 * 1024 ** 2 } });
    expect(screen.getByText(/Reading its index on the ROS host/)).toBeInTheDocument();
    worker.reply({ id: worker.last('open').id, op: 'opened', info: { ...INFO, name: 'run_1_0.mcap' } });
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
    expect(screen.getByText('3.0 MiB · 2 topics · Replaying from the ROS host')).toBeInTheDocument();
    expect(screen.getByText('On ROS host')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recordings on the ROS host' })).not.toBeInTheDocument();
  });

  it('moves through folders with breadcrumbs', async () => {
    listings[''] = LISTING;
    listings.field = { ...EMPTY, directory: 'field' };
    renderPanel();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'field' }));
    await settle();
    expect(fetchMock).toHaveBeenLastCalledWith('/recordings/list?path=field', expect.anything());
    expect(screen.getByText(/No recordings here yet/)).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Recording folder' });
    expect(within(crumbs).getByRole('button', { name: 'field' })).toHaveAttribute('aria-current', 'location');
    fireEvent.click(within(crumbs).getByRole('button', { name: 'recordings' }));
    await settle();
    expect(fetchMock).toHaveBeenLastCalledWith('/recordings/list?path=', expect.anything());
  });

  it('explains an unreachable host and tries again on request', async () => {
    listings[''] = 'down';
    renderPanel();
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('The ROS host’s recordings are not reachable');
    listings[''] = LISTING;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('run_1')).toBeInTheDocument();
  });

  it('only looks on the ROS host while connected', async () => {
    renderPanel({ connected: false, ros: null });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Recordings on the ROS host' })).not.toBeInTheDocument();
  });

  it('reconnects a remote recording where it stopped after the connection drops', async () => {
    listings[''] = LISTING;
    renderPanel();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Replay run_1_0.mcap from the ROS host' }));
    worker.reply({ id: worker.last('open').id, op: 'opened', info: INFO });
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    act(() => { vi.advanceTimersByTime(40); });
    worker.reply({ id: worker.last('read').id, op: 'error', error: 'Lost the connection to the ROS host while reading the recording (Failed to fetch).' });
    expect(screen.getByRole('alert')).toHaveTextContent('Lost the connection to the ROS host');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect and continue' }));
    expect(worker.last('open')).toMatchObject({ source: { url: remoteUrl('run_1/run_1_0.mcap') } });
  });

  it('downloads a recording with progress, then replays the copy like a dropped file', async () => {
    vi.useRealTimers();
    listings[''] = { ...EMPTY, files: [{ name: 'run_1_0.mcap', path: 'run_1/run_1_0.mcap', size: BAG_BYTES.length, modified: 0 }] };
    const written: number[] = [];
    const handle = {
      createWritable: async () => ({ write: async (chunk: Uint8Array) => { written.push(...chunk); }, close: async () => undefined, abort: async () => undefined }),
      getFile: async () => new File([new Uint8Array(written)], 'run_1_0.mcap'),
    };
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    renderPanel();
    await screen.findByText('run_1_0.mcap');
    fireEvent.click(screen.getByRole('button', { name: 'Download run_1_0.mcap' }));
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'run_1_0.mcap' }));
    const card = await screen.findByRole('status', { name: 'Download of run_1_0.mcap' });
    await waitFor(() => expect(card).toHaveTextContent('Saved · 5 KiB'));
    expect(written).toEqual([...BAG_BYTES]);
    fireEvent.click(within(card).getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(worker.last('open')).toMatchObject({ source: { name: 'run_1_0.mcap', size: BAG_BYTES.length } }));
    expect((worker.last('open') as Extract<ReaderRequest, { op: 'open' }>).source).toBeInstanceOf(File);
  });

  it('hands the download to the browser where it cannot write files itself, without leaving the page', async () => {
    listings[''] = LISTING;
    renderPanel();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Download loose.mcap' }));
    // A hidden frame downloads it; navigating the page itself would drop the robot connection in Firefox.
    const frame = document.querySelector('iframe');
    expect(frame).toHaveAttribute('src', remoteUrl('loose.mcap'));
    expect(frame?.hidden).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Your browser is downloading loose.mcap');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(document.querySelector('iframe')).toBeNull();
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

  it('finds a saved recording in Replay on the ROS host', async () => {
    recorder.value = { ...recorder.value, online: true, status: recorderStatus({ state: 'idle', path: '/recordings/field/run_9' }) };
    renderPanel();
    openRecord();
    fireEvent.click(screen.getByRole('button', { name: 'Find it in Replay' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetchMock).toHaveBeenLastCalledWith('/recordings/list?path=field%2Frun_9', expect.anything());
  });
});

describe('RecordReplayPanel and the AI assistant', () => {
  it('lets the assistant open, play and read a recording, and drive the recorder', async () => {
    const workers: FakeWorker[] = [];
    session.dispose();
    session = new ReplaySession(() => {
      const created = new FakeWorker();
      workers.push(created);
      return created as unknown as Worker;
    });
    listings[''] = LISTING;
    recorder.value = { ...recorder.value, online: true, status: recorderStatus({}) };
    let bridge: PanelSettingsBridge | null = null;
    const register = vi.fn((_id: string, value: PanelSettingsBridge | null) => { bridge = value; });
    renderPanel({ panelId: 'rr', onRegisterAssistantBridge: register });
    await settle();
    expect(register).toHaveBeenCalledWith('rr', expect.objectContaining({ panelType: 'recordReplay' }));
    expect(bridge!.describe()).toMatchObject({
      recordingsOnRosHost: { recordings: expect.arrayContaining([expect.objectContaining({ name: 'run_1', durationSec: 75 })]) },
    });

    // Open a recording stored on the ROS host, then drive playback.
    let outcomes = await bridge!.apply({ openRecording: 'run_1' });
    expect(outcomes).toEqual([{ ok: true, message: 'Opening run_1_0.mcap from the ROS host.' }]);
    const player = workers[0];
    expect(player.last('open')).toMatchObject({ source: { url: remoteUrl('run_1/run_1_0.mcap') } });
    player.reply({ id: player.last('open').id, op: 'opened', info: INFO });
    player.reply({ id: player.last('seek').id, op: 'messages', messages: [], done: true });
    expect(bridge!.describe()).toMatchObject({ replay: { name: 'field_test.mcap', durationSec: 60 } });
    await act(async () => { outcomes = await bridge!.apply({ seek: 30, speed: 2, loop: true, play: true }); });
    expect(session.snapshot).toMatchObject({ position: 30, speed: 2, loop: true, playing: true });
    await act(async () => { await bridge!.apply({ play: false }); });
    expect(session.snapshot.playing).toBe(false);
    player.reply({ id: player.last('seek').id, op: 'messages', messages: [], done: true });

    // Read the latest message at the cursor.
    const sampling = bridge!.apply({ sample: ['/odom'] });
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    player.reply({ id: player.last('seek').id, op: 'messages', done: true, messages: [{ topic: '/odom', time: START + 29n * 1_000_000_000n, message: { pose: { x: 1 } } }] });
    await act(async () => { outcomes = await sampling; });
    expect(bridge!.describe()).toMatchObject({ samples: [{ topic: '/odom', atSeconds: 30, value: { pose: { x: 1 } } }] });

    // Read a stretch with a reader of its own.
    const reading = bridge!.apply({ read: { topics: ['/odom'], fromSec: 0, toSec: 60, limit: 5 } });
    await settle();
    const reader = workers[1];
    reader.reply({ id: 1, op: 'opened', info: INFO });
    reader.reply({ id: 2, op: 'messages', done: true, messages: [{ topic: '/odom', time: START + 1_000_000_000n, message: { pose: { x: 0 } } }] });
    await act(async () => { outcomes = await reading; });
    expect(outcomes).toEqual(expect.arrayContaining([{ ok: true, message: 'Found 1 matching of 1 messages.' }]));
    expect(bridge!.describe()).toMatchObject({ lastRead: { matched: 1, messages: [{ topic: '/odom', atSec: 1, value: { pose: { x: 0 } } }] } });

    // Record on the ROS host with the options the assistant chose.
    await act(async () => { outcomes = await bridge!.apply({ recordOptions: { topics: ['/scan'] }, recorder: 'start' }); });
    expect(recorder.value.command).toHaveBeenCalledWith('start', expect.objectContaining({ topics: ['/scan'], allTopics: false }));
    expect(screen.getByRole('button', { name: /Record/ })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => { await bridge!.apply({ closeRecording: true }); });
    expect(session.snapshot.phase).toBe('empty');
    expect(bridge!.describe()).toMatchObject({ replay: { state: 'no recording open' } });
  });

  it('reports a recording that closed before a read', async () => {
    let bridge: PanelSettingsBridge | null = null;
    renderPanel({ panelId: 'rr', onRegisterAssistantBridge: (_id, value) => { bridge = value; } });
    openBag();
    const pending = bridge!.apply({ sample: ['/odom'] });
    act(() => session.close());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(await pending).toEqual(expect.arrayContaining([expect.objectContaining({ ok: false })]));
  });
});
