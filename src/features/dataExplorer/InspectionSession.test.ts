import type { Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInspectionSession } from './InspectionSession';
import type { InspectionDemand } from './types';

type Listener = (message: Record<string, unknown>) => void;
const mocks = vi.hoisted(() => ({
  topics: [] as Array<{
    name: string;
    messageType: string;
    throttle: number;
    listener?: Listener;
    published: Array<{ data: string }>;
    unsubscribed: boolean;
    unadvertised: boolean;
  }>,
  services: {} as Record<string, (args: Record<string, unknown>) => Record<string, unknown>>,
}));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      name: string;
      messageType: string;
      throttle: number;
      listener?: Listener;
      published: Array<{ data: string }> = [];
      unsubscribed = false;
      unadvertised = false;
      callForSubscribeAndAdvertise = () => undefined;
      constructor(options: { name: string; messageType: string; throttle_rate?: number }) {
        this.name = options.name;
        this.messageType = options.messageType;
        this.throttle = options.throttle_rate ?? 0;
        mocks.topics.push(this);
      }
      subscribe(listener: Listener) {
        this.listener = listener;
      }
      unsubscribe() {
        this.unsubscribed = true;
      }
      unadvertise() {
        this.unadvertised = true;
      }
      publish(message: { data: string }) {
        this.published.push(message);
      }
    },
    Message: class {
      constructor(values: object) {
        Object.assign(this, values);
      }
    },
    ServiceRequest: class {
      constructor(values: object) {
        Object.assign(this, values);
      }
    },
    Service: class {
      constructor(private options: { name: string }) {}
      callService(request: Record<string, unknown>, done: (value: unknown) => void, fail: (error: unknown) => void) {
        const handler = mocks.services[this.options.name];
        if (handler) done(handler(request));
        else fail(new Error(`no ${this.options.name}`));
      }
    },
  },
}));

const live = (name: string) => mocks.topics.filter(topic => topic.name === name && !topic.unsubscribed);
const one = (name: string) => {
  const found = live(name);
  if (found.length !== 1) throw new Error(`${found.length} live subscriptions to ${name}`);
  return found[0];
};
const leases = () =>
  mocks.topics
    .filter(topic => topic.name === '/roboboy/inspection/request')
    .flatMap(topic => topic.published.map(message => JSON.parse(message.data)));
const lastLease = () => {
  const all = leases();
  return all[all.length - 1];
};
const send = (name: string, message: Record<string, unknown>) => one(name).listener?.(message);
const graph = (resources: unknown[], revision = 1) =>
  send('/roboboy/inspection/graph', { data: JSON.stringify({ version: 1, revision, age: 0, resources }) });
const metrics = (value: Record<string, unknown>) =>
  send('/roboboy/inspection/metrics', {
    data: JSON.stringify({ version: 1, graphRevision: 1, graphAge: 0, ...value }),
  });
const demand = (patch: Partial<InspectionDemand> = {}): InspectionDemand => ({
  watch: [],
  selected: '',
  health: false,
  diagnosticTopic: '/diagnostics',
  ...patch,
});
const tick = (ms = 600) => vi.advanceTimersByTime(ms);

let ros: Ros;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  mocks.topics.length = 0;
  mocks.services = {};
  ros = {} as Ros;
  if (!globalThis.crypto?.randomUUID) vi.stubGlobal('crypto', { randomUUID: () => Math.random().toString(36) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('InspectionSession', () => {
  it('is shared per connection, unions demands, and releases only when the last panel leaves', () => {
    const session = getInspectionSession(ros);
    expect(getInspectionSession(ros)).toBe(session);
    const releaseA = session.acquire('a', demand({ watch: ['/scan'] }));
    const releaseB = session.acquire('b', demand({ watch: ['/odom'] }));
    tick(2100);
    expect(lastLease()).toMatchObject({ version: 1, watch: ['/scan', '/odom'], release: false });
    expect(live('/roboboy/inspection/graph')).toHaveLength(1);

    releaseA();
    tick(2100);
    expect(lastLease().watch).toEqual(['/odom']);
    expect(live('/roboboy/inspection/metrics')).toHaveLength(1);

    releaseB();
    expect(lastLease()).toMatchObject({ release: true });
    expect(mocks.topics.every(topic => topic.name === '/roboboy/inspection/request' || topic.unsubscribed)).toBe(true);
    expect(mocks.topics.find(topic => topic.name === '/roboboy/inspection/request')?.unadvertised).toBe(true);
    expect(session.getSnapshot().resources).toEqual([]);
  });

  it('starts in an insecure context, where crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    const release = getInspectionSession(ros).acquire('a', demand({ watch: ['/scan'] }));
    tick(2100);
    expect(lastLease().client).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    release();
  });

  it('renews its lease while running so the companion keeps probes alive', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ watch: ['/scan'] }));
    const count = leases().length;
    tick(6100);
    expect(leases().length - count).toBeGreaterThanOrEqual(2);
    release();
  });

  it('uses companion counts and host metrics, marks refused and unwatched topics honestly', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ watch: ['/scan', '/camera', '/new'] }));
    graph([
      {
        kind: 'topic',
        name: '/scan',
        types: ['sensor_msgs/msg/LaserScan'],
        publishers: 1,
        subscribers: 3,
        countKind: 'endpoints',
      },
      { kind: 'service', name: '/reset', types: ['std_srvs/srv/Trigger'], servers: 1, clients: 2, countKind: 'nodes' },
    ]);
    tick(3000);
    metrics({
      metrics: {
        '/scan': { source: 'host', rate: 10, bytesPerSec: 5000, age: 0.05, count: 30, window: 3, warming: true },
        '/nope': { source: 'host', count: 1, window: 1 },
      },
      refused: ['/camera'],
    });
    tick();
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({ mode: 'host', online: true });
    expect(snapshot.resources.find(item => item.name === '/scan')).toMatchObject({
      publishers: 1,
      subscribers: 3,
      countKind: 'endpoints',
    });
    expect(snapshot.metrics['/scan']).toMatchObject({ rate: 10, source: 'host' });
    expect(snapshot.metrics['/scan'].observed).toBeGreaterThanOrEqual(3);
    expect(snapshot.metrics['/camera']).toMatchObject({
      rate: null,
      unavailable: expect.stringContaining('probe budget is full'),
    });
    expect(snapshot.metrics['/new'].unavailable).toBe('Starting probe…');
    expect(snapshot.metrics['/nope']).toBeUndefined();
    expect(snapshot.refused).toEqual(['/camera']);

    // Unwatching removes a measurement at once, without waiting for the next metrics message.
    session.update('a', demand({ watch: ['/camera'] }));
    expect(session.getSnapshot().metrics['/scan']).toBeUndefined();
    expect(session.getSnapshot().trends['/scan']).toBeUndefined();
    release();
  });

  it('treats metrics as the heartbeat and asks again for a graph it missed', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand());
    graph([{ kind: 'topic', name: '/scan', types: ['T'] }], 1);
    for (let second = 0; second < 8; second++) {
      metrics({ metrics: {}, graphRevision: 1 });
      tick(1000);
    }
    expect(session.getSnapshot().online).toBe(true);
    metrics({ metrics: {}, graphRevision: 2 });
    expect(lastLease()).toMatchObject({ refresh: true });
    release();
  });

  it('calls a graph current only once the heartbeat confirms its revision and freshness', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand());
    // A latched graph from an earlier client: online, but not yet known to be current.
    graph([{ kind: 'topic', name: '/scan', types: ['T'] }], 3);
    expect(session.getSnapshot()).toMatchObject({ online: true, current: false });
    // The inspector has moved on: its heartbeat names a newer revision.
    metrics({ metrics: {}, graphRevision: 4, graphAge: 0.2 });
    expect(session.getSnapshot().current).toBe(false);
    graph([{ kind: 'topic', name: '/scan', types: ['T'] }, { kind: 'action', name: '/move', types: ['A'] }], 4);
    expect(session.getSnapshot().current).toBe(true);
    // A heartbeat about an old rebuild no longer vouches for the graph.
    metrics({ metrics: {}, graphRevision: 4, graphAge: 30 });
    expect(session.getSnapshot().current).toBe(false);
    metrics({ metrics: {}, graphRevision: 4, graphAge: 0.5 });
    expect(session.getSnapshot().current).toBe(true);
    release();
  });

  it('falls back to rosapi discovery and never reports a zero rate for a topic it cannot subscribe to', async () => {
    mocks.services['/rosapi/topics'] = () => ({
      topics: ['/scan', '/mixed', '/nav/_action/feedback'],
      types: ['sensor_msgs/msg/LaserScan', '', 'nav/action/Go_FeedbackMessage'],
    });
    mocks.services['/rosapi/services'] = () => ({ services: ['/reset'] });
    mocks.services['/rosapi/nodes'] = () => ({ nodes: ['/lidar'] });
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ watch: ['/scan', '/mixed', '/missing'] }));
    await vi.advanceTimersByTimeAsync(600);
    const snapshot = () => session.getSnapshot();
    expect(snapshot().mode).toBe('browser');
    expect(snapshot().resources.map(item => item.id)).toEqual(
      expect.arrayContaining(['topic:/scan', 'action:/nav', 'service:/reset', 'node:/lidar'])
    );
    // The fallback preview is throttled by rosbridge; its rate is labelled with that ceiling.
    expect(one('/scan').throttle).toBe(100);
    for (let index = 0; index < 20; index++) {
      send('/scan', { ranges: [1] });
      tick(100);
    }
    tick(800);
    expect(snapshot().metrics['/scan']).toMatchObject({ source: 'browser', ceiling: 10 });
    expect(snapshot().metrics['/scan'].rate).toBeGreaterThan(0);
    expect(snapshot().metrics['/mixed']).toMatchObject({
      rate: null,
      unavailable: 'Not measured: the topic has no single message type',
    });
    expect(snapshot().metrics['/missing']).toMatchObject({
      rate: null,
      unavailable: 'Not measured: topic not discovered',
    });
    release();
  });

  it('goes offline without a heartbeat and clears host measurements', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ watch: ['/scan'] }));
    graph([{ kind: 'topic', name: '/scan', types: ['T'] }]);
    metrics({ metrics: { '/scan': { source: 'host', rate: 5, bytesPerSec: 1, age: 0, count: 5, window: 1 } } });
    tick(5600);
    expect(session.getSnapshot()).toMatchObject({ online: false, mode: 'browser' });
    expect(session.getSnapshot().metrics['/scan']?.source).toBe('browser');
    release();
  });

  it('keeps logs, events and diagnostics bounded and reads diagnostics only from the chosen source', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ health: true }));
    graph([]);
    for (let index = 0; index < 250; index++) send('/rosout', { name: 'node', level: 20, msg: `line ${index}` });
    send('/rosout', { name: 'node', level: 20, msg: 'same' });
    send('/rosout', { name: 'node', level: 20, msg: 'same' });
    const status = (name: string, level: number) => ({
      name,
      hardware_id: 'hw',
      level,
      message: `level ${level}`,
      values: [],
    });
    send('/diagnostics', { status: [status('motor', 0), status('battery', 1)] });
    send('/diagnostics', { status: [status('motor', 2)] }); // Partial arrays update only what they name.
    tick();
    const snapshot = session.getSnapshot();
    expect(snapshot.logs).toHaveLength(200);
    expect(snapshot.logs[snapshot.logs.length - 1]).toMatchObject({ message: 'same', repeats: 2 });
    expect(snapshot.diagnostics.map(item => [item.name, item.level])).toEqual([
      ['motor', 2],
      ['battery', 1],
    ]);
    for (let index = 0; index < 250; index++) session.recordEvent(`event ${index}`);
    expect(session.getSnapshot().events).toHaveLength(200);
    release();
  });

  it('tracks action goals and their status transitions with readable identities', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ selected: 'action:/navigate' }));
    graph([{ kind: 'action', name: '/navigate', types: ['nav2_msgs/action/NavigateToPose'] }]);
    expect(one('/navigate/_action/status').messageType).toBe('action_msgs/msg/GoalStatusArray');
    expect(one('/navigate/_action/feedback').messageType).toBe('nav2_msgs/action/NavigateToPose_FeedbackMessage');
    const goal = (status: number) => ({ status_list: [{ goal_info: { goal_id: { uuid: btoa('\u0001ÿ') } }, status }] });
    send('/navigate/_action/status', goal(2));
    tick(200);
    send('/navigate/_action/status', goal(4));
    const goals = session.getSnapshot().goals['/navigate'];
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ id: '01ff', status: 4 });
    expect(goals[0].history.map(step => step.status)).toEqual([2, 4]);
    release();
  });

  it('resubscribes when a topic changes type and ignores callbacks that arrive after release', () => {
    const session = getInspectionSession(ros);
    const release = session.acquire('a', demand({ selected: 'topic:/value' }));
    graph([{ kind: 'topic', name: '/value', types: ['std_msgs/msg/Int32'] }], 1);
    const first = one('/value');
    graph([{ kind: 'topic', name: '/value', types: ['std_msgs/msg/Float64'] }], 2);
    expect(first.unsubscribed).toBe(true);
    expect(one('/value').messageType).toBe('std_msgs/msg/Float64');
    const second = one('/value');
    release();
    second.listener?.({ data: 1 });
    expect(session.getSnapshot().previews).toEqual({});
  });

  it('inspects a recording without contacting the robot', () => {
    const session = getInspectionSession(ros);
    let bagTime = 5_000;
    const release = session.acquire('a', demand({ selected: 'topic:/speed', health: true }), {
      info: {
        name: 'run.mcap',
        size: 1,
        start: 0n,
        end: 10_000_000_000n,
        topics: [{ name: '/speed', type: 'std_msgs/msg/Float64', count: 100, definition: 'float64 data' }],
      },
      clock: () => bagTime,
    });
    expect(session.getSnapshot()).toMatchObject({ mode: 'recorded', loading: false });
    expect(session.getSnapshot().resources[0]).toMatchObject({
      name: '/speed',
      recordedCount: 100,
      definition: 'float64 data',
    });
    expect(mocks.topics.some(topic => topic.name.startsWith('/roboboy/inspection'))).toBe(false);
    send('/speed', { data: 3 });
    expect(session.getSnapshot().previews['/speed'].receivedAt).toBe(5_000);
    bagTime = 6_000;
    tick();
    expect(session.getSnapshot().now).toBe(6_000);
    release();
    expect(session.getSnapshot().previews).toEqual({});
  });
});
