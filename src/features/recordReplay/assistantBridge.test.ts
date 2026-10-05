import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeRecordReplay,
  planRecordReplaySettings,
  readRecording,
  sampleRecording,
  valueAt,
  type RecordReplayBridgeInput,
} from './assistantBridge';
import { ReplaySession, type ReplaySnapshot } from './ReplaySession';
import { defaultRecordOptions, type BagInfo, type ReaderRequest, type ReaderResponse, type ReplayMessage } from './types';

const START = 1_000n * 1_000_000_000n;
const at = (seconds: number) => START + BigInt(Math.round(seconds * 1e9));
const INFO: BagInfo = {
  name: 'run.mcap',
  size: 2048,
  start: START,
  end: at(100),
  topics: [
    { name: '/battery', type: 'sensor_msgs/msg/BatteryState', count: 100, definition: 'float32 percentage\n'.repeat(40) },
    { name: '/rosout', type: 'rcl_interfaces/msg/Log', count: 20 },
    { name: '/broken', type: 'x/Y', count: 1, error: 'Unsupported encoding' },
  ],
};
const replaySnapshot = (patch: Partial<ReplaySnapshot> = {}): ReplaySnapshot => ({
  phase: 'ready',
  info: INFO,
  position: 10,
  playing: false,
  speed: 1,
  loop: false,
  remote: false,
  buffering: false,
  ...patch,
});
const listing = {
  directory: 'runs',
  folders: ['old'],
  files: [{ name: 'loose.mcap', path: 'runs/loose.mcap', size: 10, modified: 0 }],
  recordings: [
    { name: 'day1', path: 'runs/day1', active: false, duration: 60, messages: 900, files: [{ name: 'day1_0.mcap', path: 'runs/day1/day1_0.mcap', size: 99, modified: 0 }] },
    { name: 'split', path: 'runs/split', active: false, files: [{ name: 'a.mcap', path: 'runs/split/a.mcap', size: 1, modified: 0 }, { name: 'b.mcap', path: 'runs/split/b.mcap', size: 1, modified: 0 }] },
    { name: 'live', path: 'runs/live', active: true, files: [{ name: 'live_0.mcap', path: 'runs/live/live_0.mcap', size: 1, modified: 0 }] },
  ],
};
const input = (patch: Partial<RecordReplayBridgeInput> = {}): RecordReplayBridgeInput => ({
  replay: replaySnapshot(),
  duration: 100,
  tab: 'replay',
  connected: true,
  recorder: { online: true, pending: false, error: '', status: { version: 1, state: 'idle', root: '/recordings', path: '', messages: 0, bytes: 0, dropped: 0, elapsed: 0, topics: [] } },
  options: { ...defaultRecordOptions(), name: 'run_1' },
  remote: { status: 'idle' },
  samples: [],
  ...patch,
});
const plan = (settings: Record<string, unknown>, patch: Partial<RecordReplayBridgeInput> = {}) =>
  planRecordReplaySettings(settings, input(patch));

describe('Record & Replay as the assistant sees it', () => {
  it('describes the open recording, its topics and the recorder', () => {
    const view = describeRecordReplay(input({ samples: [{ topic: '/battery', type: 't', atSeconds: 10.123, value: { percentage: 0.5 } }] }));
    expect(view.replay).toMatchObject({ name: 'run.mcap', from: 'this device', durationSec: 100, state: 'paused', positionSec: 10 });
    expect((view.replay as { topics: unknown[] }).topics[0]).toMatchObject({ name: '/battery', messages: 100, averageHz: 1 });
    expect(((view.replay as { topics: { definition: string }[] }).topics[0]).definition).toHaveLength(301);
    expect((view.replay as { topics: unknown[] }).topics[2]).toMatchObject({ unreadable: 'Unsupported encoding' });
    expect(view.samples).toEqual([{ topic: '/battery', type: 't', atSeconds: 10.12, value: { percentage: 0.5 } }]);
    expect(view.recorder).toMatchObject({ available: true, state: 'idle', options: { name: 'run_1' } });
    expect(view.recordingsOnRosHost).toBeUndefined();
  });

  it('lists recordings on the ROS host while no recording is open', () => {
    const view = describeRecordReplay(input({ replay: replaySnapshot({ info: undefined, phase: 'empty' }), remote: { status: 'ready', path: 'runs', listing } }));
    expect(view.replay).toEqual({ state: 'no recording open', error: undefined });
    expect(view.recordingsOnRosHost).toMatchObject({
      folder: 'runs',
      folders: ['old'],
      recordings: [{ name: 'day1', durationSec: 60 }, { name: 'split' }, { name: 'live', stillRecording: true }],
      files: [{ path: 'runs/loose.mcap', sizeBytes: 10 }],
    });
    const idle = describeRecordReplay(input({ replay: replaySnapshot({ info: undefined, phase: 'empty' }) }));
    expect(idle.recordingsOnRosHost).toContain('Listed while');
    const recording = describeRecordReplay(input({ connected: false, recorder: { online: false, pending: false, error: '', status: { version: 1, state: 'recording', root: '/r', path: '/r/x', messages: 5, bytes: 9, dropped: 0, elapsed: 3, topics: ['/a'] } } }));
    expect(recording.recorder).toMatchObject({ available: 'not connected to ROS', messages: 5, recordingTopics: ['/a'] });
  });
});

describe('Record & Replay settings from the assistant', () => {
  it('drives playback of the open recording', () => {
    const result = plan({ seek: 500, speed: 2, loop: true, play: true });
    expect(result.steps).toEqual([
      { kind: 'seek', seconds: 100 },
      { kind: 'speed', speed: 2 },
      { kind: 'loop', loop: true },
      { kind: 'play', playing: true },
    ]);
    expect(result.outcomes.every(outcome => outcome.ok)).toBe(true);
    expect(plan({ speed: 3 }).outcomes[0].ok).toBe(false);
    expect(plan({ play: true }, { replay: replaySnapshot({ info: undefined }) }).outcomes[0].message).toContain('No recording is open');
  });

  it('opens recordings from the ROS host, but never a file from this device', () => {
    const remote = { status: 'ready' as const, path: 'runs', listing };
    const empty = replaySnapshot({ info: undefined, phase: 'empty' });
    expect(plan({ openRecording: 'runs/day1' }, { replay: empty, remote }).steps).toEqual([
      { kind: 'tab', tab: 'replay' },
      { kind: 'open', file: listing.recordings[0].files[0] },
    ]);
    expect(plan({ openRecording: 'loose.mcap' }, { replay: empty, remote }).steps[1]).toMatchObject({ kind: 'open', file: { name: 'loose.mcap' } });
    expect(plan({ openRecording: 'runs/split' }, { replay: empty, remote }).outcomes[0].message).toContain('split into 2 files');
    expect(plan({ openRecording: 'runs/live' }, { replay: empty, remote }).outcomes[0].message).toContain('still being recorded');
    expect(plan({ openRecording: 'nowhere.mcap' }, { replay: empty, remote }).outcomes[0].message).toContain('chosen by the user');
    expect(plan({ openRecording: 'x.mcap' }).outcomes[0].message).toContain('not listed yet');
    // A recording that was only just asked to open cannot be played in the same request.
    expect(plan({ openRecording: 'runs/day1', play: true }, { replay: empty, remote }).outcomes[1].message).toContain('still opening');
    expect(plan({ closeRecording: true, browse: '/runs/' }).steps).toEqual([
      { kind: 'close' },
      { kind: 'tab', tab: 'replay' },
      { kind: 'browse', path: 'runs' },
    ]);
    expect(plan({ closeRecording: true }, { replay: empty }).outcomes[0].ok).toBe(false);
  });

  it('samples and reads readable topics only', () => {
    expect(plan({ sample: ['/battery', '/broken', '/none'] }).steps).toEqual([
      { kind: 'sample', topics: [{ name: '/battery', type: 'sensor_msgs/msg/BatteryState' }] },
    ]);
    expect(plan({ sample: '/battery' }).outcomes[1]).toBeUndefined();
    const read = plan({ read: { topics: ['/rosout', '/none'], fromSec: -5, toSec: 50, limit: 9999, everySec: 2, fields: ['msg', 3], match: ' error ' } });
    expect(read.steps).toEqual([
      { kind: 'read', request: { topics: ['/rosout'], fromSec: 0, toSec: 50, limit: 300, everySec: 2, fields: ['msg'], match: 'error' } },
    ]);
    expect(read.outcomes[1]).toEqual({ ok: false, message: 'The recording has no readable topic /none.' });
    expect(plan({ read: { topics: '/battery' } }).steps[0]).toMatchObject({ request: { fromSec: 0, toSec: 100, limit: 100 } });
    expect(plan({ read: { topics: [] } }).outcomes[0].message).toBe('Name the topics to read.');
    expect(plan({ read: { topics: ['/battery'], fromSec: 50, toSec: 10 } }).outcomes[0].ok).toBe(false);
  });

  it('sets recording options and drives the recorder when it can', () => {
    const configured = plan({ recordOptions: { topics: ['/a', 'bad', '/a'], name: 'bad name', compression: 'none', frequency: -1, colour: 1 }, recorder: 'start' });
    expect(configured.steps).toEqual([
      { kind: 'tab', tab: 'record' },
      { kind: 'options', patch: { topics: ['/a'], compression: 'none', allTopics: false } },
      { kind: 'tab', tab: 'record' },
      { kind: 'recorder', command: 'start', options: expect.objectContaining({ topics: ['/a'], allTopics: false, compression: 'none' }) },
    ]);
    expect(configured.outcomes[1].message).toContain('name (letters');
    expect(configured.outcomes[2].message).toContain('Started recording /a to run_1');

    const status = (state: 'recording' | 'paused' | 'idle') => ({ version: 1 as const, state, root: '/r', path: '', messages: 0, bytes: 0, dropped: 0, elapsed: 0, topics: [] });
    const recording = { recorder: { online: true, pending: false, error: '', status: status('recording') } };
    expect(plan({ recorder: 'stop' }, recording).steps[1]).toEqual({ kind: 'recorder', command: 'stop' });
    expect(plan({ recorder: 'start' }, recording).outcomes[0].message).toBe('A recording is already running.');
    expect(plan({ recordOptions: { name: 'next' } }, recording).outcomes[0].message).toContain('stop it first');
    expect(plan({ recorder: 'resume' }, recording).outcomes[0].ok).toBe(false);
    expect(plan({ recorder: 'stop' }).outcomes[0].message).toBe('No recording is running.');
    expect(plan({ recorder: 'start' }, { connected: false }).outcomes[0].message).toContain('Connect to ROS');
    expect(plan({ recorder: 'start' }, { recorder: { online: false, pending: false, error: '' } }).outcomes[0].ok).toBe(false);
    expect(plan({ recorder: 'start' }, { recorder: { online: true, pending: true, error: '' } }).outcomes[0].ok).toBe(false);
    expect(plan({ recorder: 'start' }, { options: { ...defaultRecordOptions(), allTopics: false } }).outcomes[0].message).toContain('Choose topics');
    expect(plan({ recorder: 'explode' }).outcomes[0].ok).toBe(false);
  });

  it('says what it did not understand', () => {
    expect(plan({ tab: 'record', volume: 3 }).outcomes).toEqual([
      { ok: true, message: 'Showing the Record tab.' },
      { ok: false, message: 'Record & Replay has no setting "volume".' },
    ]);
    expect(plan({}).outcomes[0].message).toContain('Nothing in those settings applies');
  });
});

describe('reading a stretch of a recording', () => {
  const messages: ReplayMessage[] = Array.from({ length: 10 }, (_, index) => ({
    topic: '/rosout',
    time: at(index),
    message: { level: index % 2 ? 40 : 20, msg: index % 2 ? `Error ${index}` : `ok ${index}`, nested: { values: [index] } },
  }));
  const range = (items = messages) => async (_from: number, _to: number, _topics: string[], keep: (item: ReplayMessage) => boolean | 'stop') => {
    for (const item of items) if (keep(item) === 'stop') return { complete: false };
    return { complete: true };
  };

  it('filters, down-samples, picks fields and still counts what it did not return', async () => {
    const result = await readRecording(range(), { topics: ['/rosout'], fromSec: 0, toSec: 10, limit: 2, match: 'ERROR', fields: ['msg', 'nested.values[0]'] }, START);
    expect(result).toMatchObject({ scanned: 10, matched: 5 });
    expect(result.messages).toEqual([
      { topic: '/rosout', atSec: 1, value: { msg: 'Error 1', 'nested.values[0]': 1 } },
      { topic: '/rosout', atSec: 3, value: { msg: 'Error 3', 'nested.values[0]': 3 } },
    ]);
    const sparse = await readRecording(range(), { topics: ['/rosout'], fromSec: 0, toSec: 10, limit: 100, everySec: 3 }, START);
    expect(sparse.messages.map(item => item.atSec)).toEqual([0, 3, 6, 9]);
    expect(sparse.matched).toBe(4);
  });

  it('stops when it takes too long, and reports a failed read', async () => {
    let clock = 0;
    const slow = await readRecording(range(), { topics: ['/rosout'], fromSec: 0, toSec: 10, limit: 100 }, START, () => (clock += 7000));
    expect(slow.stoppedBecause).toBe('took more than 20 s');
    expect(slow.stoppedAtSec).toBe(2);
    const failed = await readRecording(() => Promise.reject(new Error('Range request failed')), { topics: ['/a'], fromSec: 0, toSec: 1, limit: 1 }, START);
    expect(failed.error).toBe('Range request failed');
  });

  it('reads nested values by path', () => {
    expect(valueAt({ a: { b: [1, { c: 2 }] } }, 'a.b[1].c')).toBe(2);
    expect(valueAt({ a: 1 }, 'a.b')).toBeUndefined();
  });
});

describe('the replay session for the assistant', () => {
  class FakeWorker {
    requests: Array<ReaderRequest | { op: 'ack'; id: number }> = [];
    onmessage: ((event: MessageEvent<ReaderResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    postMessage(request: ReaderRequest) { this.requests.push(request); }
    terminate() { this.terminated = true; }
    last<T extends string>(op: T) {
      return [...this.requests].reverse().find(request => request.op === op) as Extract<ReaderRequest | { op: 'ack'; id: number }, { op: T }>;
    }
    reply(response: ReaderResponse) { this.onmessage?.({ data: response } as MessageEvent<ReaderResponse>); }
  }
  let workers: FakeWorker[];
  let session: ReplaySession;
  const start = () => {
    workers = [];
    session = new ReplaySession(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    session.open({ name: 'run.mcap' } as File);
    workers[0].reply({ id: workers[0].last('open').id, op: 'opened', info: INFO });
    workers[0].reply({ id: workers[0].last('seek').id, op: 'messages', messages: [], done: true });
  };
  afterEach(() => {
    session.dispose();
    vi.useRealTimers();
  });

  it('reads a stretch with a reader of its own, leaving playback alone', async () => {
    start();
    const kept: number[] = [];
    const reading = session.readRange(10, 20, ['/battery'], item => { kept.push(Number(item.time - START) / 1e9); return kept.length < 3 || 'stop'; });
    const reader = workers[1];
    expect(reader).toBeDefined();
    expect(reader.last('open')).toMatchObject({ op: 'open' });
    reader.reply({ id: 1, op: 'opened', info: INFO });
    expect(reader.last('read')).toMatchObject({ start: at(10), end: at(20), topics: ['/battery'] });
    reader.reply({ id: 2, op: 'messages', done: false, messages: [{ topic: '/battery', time: at(11), message: {} }] });
    expect(reader.last('ack')).toEqual({ op: 'ack', id: 2 });
    reader.reply({ id: 2, op: 'messages', done: false, messages: [{ topic: '/battery', time: at(12), message: {} }, { topic: '/battery', time: at(13), message: {} }] });
    await expect(reading).resolves.toEqual({ complete: false });
    expect(kept).toEqual([11, 12, 13]);
    expect(reader.terminated).toBe(true);
    expect(workers[0].terminated).toBe(false);

    const failing = session.readRange(0, 1, ['/battery'], () => true);
    workers[2].reply({ id: 1, op: 'error', error: 'Cannot read' });
    await expect(failing).rejects.toThrow('Cannot read');
    const controller = new AbortController();
    const cancelled = session.readRange(0, 1, ['/battery'], () => true, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    controller.abort();
    await expect(session.readRange(0, 1, ['/a'], () => true, controller.signal)).rejects.toThrow('cancelled');
    session.close();
    await expect(session.readRange(0, 1, ['/a'], () => true)).rejects.toThrow('No recording is open.');
  });

  it('samples the latest message of a topic at the cursor', async () => {
    vi.useFakeTimers();
    start();
    const sampling = sampleRecording(session.source.ros!, [{ name: '/battery', type: 'sensor_msgs/msg/BatteryState' }, { name: '/rosout', type: 'rcl_interfaces/msg/Log' }], 10);
    await vi.advanceTimersByTimeAsync(60);
    workers[0].reply({ id: workers[0].last('seek').id, op: 'messages', done: true, messages: [{ topic: '/battery', time: at(9), message: { percentage: 0.4 } }] });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(sampling).resolves.toEqual([
      { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', atSeconds: 10, value: { percentage: 0.4 } },
      { topic: '/rosout', type: 'rcl_interfaces/msg/Log', atSeconds: 10, unavailable: 'No message of this topic at or before this position.' },
    ]);
  });
});
