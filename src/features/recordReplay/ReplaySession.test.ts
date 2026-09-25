import ROSLIB, { type Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplaySession } from './ReplaySession';
import type { BagInfo, ReaderRequest, ReaderResponse, ReplayMessage } from './types';

const START = 1_000n * 1_000_000_000n;
const at = (seconds: number) => START + BigInt(Math.round(seconds * 1e9));
const INFO: BagInfo = {
  name: 'bag.mcap', size: 1024, start: START, end: at(30),
  topics: [
    { name: '/a', type: 'std_msgs/msg/Float64', count: 10 },
    { name: '/tf', type: 'tf2_msgs/msg/TFMessage', count: 10 },
    { name: '/broken', type: 'x/Y', count: 1, error: 'Unsupported encoding' },
  ],
};

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

let worker: FakeWorker;
let session: ReplaySession;
const message = (topic: string, seconds: number, value: Record<string, unknown>): ReplayMessage => ({ topic, time: at(seconds), message: value });
const file = (name = 'bag.mcap') => ({ name }) as File;
const open = () => {
  session.open(file());
  worker.reply({ id: worker.last('open').id, op: 'opened', info: INFO });
  const ros = session.getSource().ros!;
  worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
  return ros;
};
const listen = (ros: Ros, name: string) => {
  const received: unknown[] = [];
  const topic = new ROSLIB.Topic({ ros, name, messageType: 'x' });
  topic.subscribe(value => received.push(value));
  return { topic, received };
};

beforeEach(() => {
  vi.useFakeTimers();
  worker = new FakeWorker();
  session = new ReplaySession(() => worker as unknown as Worker);
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
});

describe('ReplaySession', () => {
  it('rejects files that are not MCAP', () => {
    session.open(file('notes.txt'));
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'Choose an .mcap recording.' });
    expect(worker.requests).toEqual([]);
  });

  it('opens a recording and exposes it as a read-only ROS source', () => {
    const listener = vi.fn();
    const sourceListener = vi.fn();
    session.subscribe(listener);
    session.subscribeSource(sourceListener);
    session.open(file());
    expect(session.getSnapshot().phase).toBe('loading');
    expect(worker.last('open')).toMatchObject({ op: 'open', file: { name: 'bag.mcap' } });

    worker.reply({ id: worker.last('open').id, op: 'opened', info: INFO });
    expect(session.getSnapshot()).toMatchObject({ phase: 'seeking', info: INFO, position: 0 });
    expect(session.getSource()).toMatchObject({ generation: 1 });
    expect(sourceListener).toHaveBeenCalled();
    expect(session.duration).toBe(30);

    const ros = session.getSource().ros!;
    const topics = vi.fn();
    ros.getTopics(topics);
    expect(topics).toHaveBeenCalledWith({ topics: ['/a', '/tf'], types: ['std_msgs/msg/Float64', 'tf2_msgs/msg/TFMessage'] });
    const type = vi.fn();
    ros.getTopicType('/a', type);
    expect(type).toHaveBeenCalledWith('std_msgs/msg/Float64');
    expect(listener).toHaveBeenCalled();
  });

  it('answers rosapi topic lookups from the file and refuses other services', async () => {
    const ros = open();
    const call = (service: string, args: Record<string, unknown> = {}) => new Promise((resolve, reject) =>
      new ROSLIB.Service({ ros, name: service, serviceType: 'x' }).callService(new ROSLIB.ServiceRequest(args), resolve, reject));
    const topics = call('/rosapi/topics');
    const type = call('/rosapi/topic_type', { topic: '/tf' });
    const byType = call('/rosapi/topics_for_type', { type: 'std_msgs/msg/Float64' });
    const other = call('/robot/reset').catch((error: unknown) => ({ rejected: error }));
    await vi.runAllTimersAsync();
    await expect(topics).resolves.toEqual({ topics: ['/a', '/tf'], types: ['std_msgs/msg/Float64', 'tf2_msgs/msg/TFMessage'] });
    await expect(type).resolves.toEqual({ type: 'tf2_msgs/msg/TFMessage' });
    await expect(byType).resolves.toEqual({ topics: ['/a'] });
    await expect(other).resolves.toEqual({ rejected: 'Services are unavailable in local replay.' });
  });

  it('loads state for new subscribers, then streams windows with backpressure', async () => {
    const ros = open();
    const a = listen(ros, '/a');
    await vi.advanceTimersByTimeAsync(50);
    const refresh = worker.last('seek');
    expect(refresh).toMatchObject({ topics: ['/a'], time: START });
    worker.reply({ id: refresh.id, op: 'messages', messages: [message('/a', 0, { data: 1 })], done: true });
    expect(a.received).toEqual([{ data: 1 }]);
    expect(session.messageTime).toBe(1_000_000);

    session.play();
    expect(session.getSnapshot().playing).toBe(true);
    await vi.advanceTimersByTimeAsync(40);
    const read = worker.last('read');
    expect(read).toMatchObject({ op: 'read', topics: ['/a'] });
    expect(read.start).toBe(START + 1n);
    expect(read.end > START).toBe(true);

    worker.reply({ id: read.id, op: 'messages', messages: [message('/a', 0.01, { data: 2 })], done: false });
    expect(worker.last('ack')).toEqual({ op: 'ack', id: read.id });
    worker.reply({ id: read.id, op: 'messages', messages: [message('/a', 0.02, { data: 3 })], done: true });
    expect(a.received).toEqual([{ data: 1 }, { data: 2 }, { data: 3 }]);
    expect(session.getSnapshot().position).toBeGreaterThan(0);

    const reads = worker.requests.filter(request => request.op === 'read').length;
    await vi.advanceTimersByTimeAsync(40);
    expect(worker.requests.filter(request => request.op === 'read').length).toBe(reads + 1);

    session.pause();
    await vi.advanceTimersByTimeAsync(100);
    expect(worker.requests.filter(request => request.op === 'read').length).toBe(reads + 1);
    a.topic.unsubscribe();
  });

  it('replays the cursor state to a late subscriber and merges TF frames', async () => {
    const ros = open();
    const first = listen(ros, '/tf');
    await vi.advanceTimersByTimeAsync(50);
    worker.reply({ id: worker.last('seek').id, op: 'messages', done: true, messages: [
      message('/tf', 1, { transforms: [{ child_frame_id: 'a', x: 1 }] }),
    ] });
    session.play();
    await vi.advanceTimersByTimeAsync(40);
    worker.reply({ id: worker.last('read').id, op: 'messages', done: true, messages: [
      message('/tf', 1.01, { transforms: [{ child_frame_id: 'b', x: 2 }] }),
      message('/tf', 1.02, { transforms: [{ child_frame_id: 'a', x: 3 }] }),
    ] });
    session.pause();
    expect(first.received).toHaveLength(3);

    const late = listen(ros, '/tf');
    await Promise.resolve();
    expect(late.received).toEqual([{ transforms: [{ child_frame_id: 'a', x: 3 }, { child_frame_id: 'b', x: 2 }] }]);
  });

  it('keeps panel state moving forward and rebuilds it moving backward', async () => {
    const ros = open();
    listen(ros, '/a');
    await vi.advanceTimersByTimeAsync(50);
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });

    session.seek(20);
    expect(session.getSource().ros).toBe(ros);
    expect(worker.last('seek')).toMatchObject({ time: at(20), topics: ['/a'] });
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [message('/a', 19.5, { data: 7 })], done: true });
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', position: 20 });

    session.seek(5);
    const rebuilt = session.getSource();
    expect(rebuilt.ros).not.toBe(ros);
    expect(rebuilt.generation).toBe(2);
    expect(worker.last('seek')).toMatchObject({ time: at(5), topics: ['/a'] });

    session.seek(Number.NaN);
    expect(session.getSnapshot().position).toBe(5);
    session.seek(99, false);
    expect(session.getSnapshot().position).toBe(30);
  });

  it('stops at the end, or loops back to the start when loop is on', async () => {
    open();
    session.seek(29.99);
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
    session.play();
    await vi.advanceTimersByTimeAsync(40);
    worker.reply({ id: worker.last('read').id, op: 'messages', messages: [], done: true });
    expect(session.getSnapshot()).toMatchObject({ position: 30, playing: false });

    session.setLoop(true);
    session.play();
    expect(worker.last('seek')).toMatchObject({ time: START });
    worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
    expect(session.getSnapshot()).toMatchObject({ position: 0, playing: true, loop: true });
  });

  it('only accepts the offered speeds', () => {
    open();
    session.setSpeed(4);
    expect(session.getSnapshot().speed).toBe(4);
    session.setSpeed(3);
    expect(session.getSnapshot().speed).toBe(4);
  });

  it('reports reader errors and ignores stale responses', () => {
    open();
    const listener = vi.fn();
    session.subscribe(listener);
    worker.reply({ id: -1, op: 'error', error: 'stale' });
    expect(listener).not.toHaveBeenCalled();
    worker.reply({ id: worker.last('seek').id, op: 'error', error: 'Corrupt chunk' });
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'Corrupt chunk', playing: false });
    session.play();
    expect(session.getSnapshot().playing).toBe(false);

    worker.onerror?.({ message: '' } as ErrorEvent);
    expect(session.getSnapshot().error).toBe('The recording reader stopped unexpectedly.');
  });

  it('closes back to live data and releases the worker', () => {
    open();
    const sourceListener = vi.fn();
    session.subscribeSource(sourceListener);
    session.close();
    expect(worker.terminated).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ phase: 'empty', info: undefined, playing: false });
    expect(session.getSource().ros).toBeNull();
    expect(sourceListener).toHaveBeenCalled();
  });

  it('reports a worker that cannot start', () => {
    const failing = new ReplaySession(() => { throw new Error('no workers'); });
    failing.open(file());
    expect(failing.getSnapshot()).toMatchObject({ phase: 'error', error: 'Error: no workers' });
  });
});
