import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ros } from 'roslib';
import { RemoteTreeRuntime, RUNTIME_EVENTS_TOPIC } from './RemoteTreeRuntime';
import { treeFormats } from './xml';

const fake = vi.hoisted(() => ({ topics: [] as any[], listeners: new Map<string, () => void>() }));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      name: string;
      listener: any;
      publish = vi.fn();
      unsubscribe = vi.fn();
      unadvertise = vi.fn();
      constructor(options: any) {
        this.name = options.name;
        fake.topics.push(this);
      }
      subscribe(listener: any) {
        this.listener = listener;
      }
    },
    Message: class {
      data: string;
      constructor(message: any) {
        this.data = message.data;
      }
    },
  },
}));
let client: RemoteTreeRuntime;
const ros = {
  isConnected: true,
  on: (name: string, fn: () => void) => fake.listeners.set(name, fn),
  off: (name: string) => fake.listeners.delete(name),
};
const node = {
  id: 'node',
  parentId: null,
  label: 'Test',
  type: 'Wait',
  status: 'running',
  nativeStatus: 'RUNNING',
  feedback: 'Waiting',
};
const session = {
  id: 'session',
  runtime: 'btcpp',
  xml: treeFormats[0].template,
  mainTreeId: 'Main',
  state: 'running',
  nodes: [node],
  result: null,
  error: null,
};
let seq = 0;
function event(patch: Record<string, unknown>) {
  fake.topics
    .find(t => t.name === RUNTIME_EVENTS_TOPIC)
    .listener({
      data: JSON.stringify({ protocolVersion: 2, hostId: 'host', sequence: ++seq, type: 'snapshot', ...patch }),
    });
}
function command() {
  return JSON.parse(fake.topics[0].publish.mock.lastCall![0].data);
}
function reply(patch: Record<string, unknown> = {}) {
  event({ type: 'response', requestId: command().requestId, ok: true, ...patch });
}
beforeEach(() => {
  vi.useFakeTimers();
  fake.topics.length = 0;
  fake.listeners.clear();
  seq = 0;
  ros.isConnected = true;
  client = new RemoteTreeRuntime(ros as unknown as Ros);
});
afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});

describe('common ROS runtime client', () => {
  it('discovers both runtimes with capability/unavailability reasons', async () => {
    const promise = client.discover();
    expect(command().command).toBe('discover');
    reply({
      runtimes: [
        { id: 'btcpp', label: 'BehaviorTree.CPP', available: true },
        { id: 'py_trees', available: false, reason: 'XML parser missing' },
      ],
    });
    await promise;
    expect(client.getState().runtimes).toHaveLength(2);
    expect(client.getState().runtimes[1].reason).toBe('XML parser missing');
  });
  it.each(['Wait', [4], null])('rejects malformed discovered node libraries %j', nodes => {
    event({ runtimes: [{ id: 'btcpp', available: true, nodes }] });
    expect(client.getState().runtimes).toEqual([]);
  });
  it.each(treeFormats)('loads $id without changing source and uses correlated lifecycle controls', async format => {
    const promise = client.load({ runtime: format.id, xml: format.template });
    expect(command()).toMatchObject({ command: 'load', runtime: format.id, xml: format.template, mainTreeId: 'Main' });
    reply({ session: { ...session, runtime: format.id, xml: format.template, state: 'loaded' } });
    await promise;
    for (const name of ['start', 'stop', 'cancel', 'reset'] as const) {
      const control = client[name]();
      expect(command()).toMatchObject({ command: name, sessionId: 'session' });
      reply();
      await control;
    }
  });
  it('synchronizes live nodes, feedback and terminal results; ignores stale snapshots', () => {
    event({ session });
    event({ type: 'log', session, log: { type: 'feedback', id: 'node', feedback: { progress: 0.5 } } });
    event({
      session: {
        ...session,
        state: 'completed',
        result: 'success',
        nodes: [{ ...node, status: 'idle', lastResult: 'success', lastNativeResult: 'SUCCESS' }],
      },
    });
    event({ sequence: 1, session });
    expect(client.getState().session?.result).toBe('success');
    expect(client.getState().session?.nodes[0]).toMatchObject({ status: 'idle', lastResult: 'success' });
    expect(client.getState().logs[0].feedback).toEqual({ progress: 0.5 });
  });
  it('preserves native port metadata for the node inspector', () => {
    event({ session: { ...session, nodes: [{ ...node, ports: { goal: '{target}', timeout: '8' } }] } });
    expect(client.getState().session?.nodes[0].ports).toEqual({ goal: '{target}', timeout: '8' });
  });
  it.each([null, [], { goal: 4 }])('rejects malformed port metadata %j without replacing current state', ports => {
    event({ session });
    event({ session: { ...session, nodes: [{ ...node, ports }] } });
    expect(client.getState().session?.nodes[0].ports).toBeUndefined();
  });
  it('merges compact snapshots without losing original XML and clears prior run logs', () => {
    event({ session: { ...session, runId: 'run-one' } });
    event({ type: 'log', log: { type: 'feedback', feedback: 'old' } });
    const { xml: _xml, ...compact } = session;
    event({ session: { ...compact, runId: 'run-one', nodes: [{ ...node, status: 'success' }] } });
    expect(client.getState().session?.xml).toBe(session.xml);
    expect(client.getState().session?.nodes[0].status).toBe('success');
    event({ session: { ...compact, state: 'loaded', runId: null } });
    expect(client.getState().logs).toEqual([]);
  });
  it('reports command failures and retains host authoritative session', async () => {
    event({ session });
    const promise = client.reset();
    const rejection = expect(promise).rejects.toThrow('Cannot reset');
    reply({ ok: false, error: 'Cannot reset' });
    await rejection;
    expect(client.getState().session?.state).toBe('running');
  });
  it('rejects invalid payloads and unsupported protocol versions', () => {
    event({ protocolVersion: 1, session });
    event({ session: { id: 42 } });
    event({ session: { ...session, nodes: [{ ...node, nativeStatus: null }] } });
    event({ session: { ...session, nodes: [{ ...node, feedback: {} }] } });
    event({ session, error: {} });
    event({ session, log: { type: 'error', message: {} } });
    event({ session, log: { type: 'error', id: {} } });
    expect(client.getState().session).toBeNull();
  });
  it('handles ROS disconnect and rejects pending requests without claiming cancellation', async () => {
    event({ session });
    const pending = client.cancel();
    const rejection = expect(pending).rejects.toThrow('lost');
    fake.listeners.get('close')!();
    await rejection;
    expect(client.getState().connected).toBe(false);
    expect(client.getState().session?.state).toBe('running');
  });
  it('times out missing acknowledgements and stale heartbeats', async () => {
    event({ session });
    const pending = client.status();
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(16000);
    await rejection;
    expect(client.getState().connected).toBe(false);
  });
  it('explains missing host executors when discovery receives no acknowledgement', async () => {
    const pending = client.discover();
    const rejection = expect(pending).rejects.toThrow('Start or update the host executor');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(client.getState().connected).toBe(false);
    expect(client.getState().error).toContain('No Behavior Tree executor responded');
  });
  it('detects a vanished host even after a command error', async () => {
    event({ session });
    const pending = client.reset();
    const rejection = expect(pending).rejects.toThrow('Cannot reset');
    reply({ ok: false, error: 'Cannot reset' });
    await rejection;
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.getState().connected).toBe(false);
    expect(client.getState().session?.state).toBe('running');
  });
  it('recovers host snapshots and rejects stale boot IDs after a restart', () => {
    event({ session });
    event({ hostId: 'new-host', sequence: 1, session: { ...session, id: 'new-session' } });
    event({ hostId: 'host', sequence: 500, session });
    expect(client.getState().session?.id).toBe('new-session');
  });
  it('cleans up subscriptions and does not stop host execution on disposal', () => {
    client.dispose();
    expect(fake.topics[0].publish).not.toHaveBeenCalled();
    expect(fake.topics[1].unsubscribe).toHaveBeenCalled();
  });
});

describe('independent robot observations', () => {
  const external = { ...session, id: 'external', name: 'Robot mission', source: 'tcp://robot:1667', connected: true, updatedAt: 123 };
  it('discovers and merges native telemetry without acquiring session ownership', () => {
    event({ observations: [external] });
    expect(client.getState().session).toBeNull();
    event({ type: 'observation', observation: { ...external, xml: undefined, nodes: [{ ...node, feedback: 'Arrived' }] } });
    expect(client.getState().observations?.[0]).toMatchObject({ xml: session.xml, nodes: [{ feedback: 'Arrived' }] });
    expect(fake.topics[0].publish).not.toHaveBeenCalled();
    event({ type: 'observation', observation: { ...external, id: 'restarted', connected: false } });
    expect(client.getState().observations).toHaveLength(1);
    expect(client.getState().observations?.[0].id).toBe('restarted');
  });
  it('retains the last graph on ROS loss, and discards old host observations after restart', () => {
    event({ observations: [external] });
    fake.listeners.get('close')!();
    expect(client.getState().connected).toBe(false);
    expect(client.getState().observations?.[0]).toEqual(external);
    event({ hostId: 'new-host', observations: [] });
    expect(client.getState().observations).toEqual([]);
  });
  it('applies live-field deltas on top of the version it holds, and resyncs after a gap', () => {
    const child = { ...node, id: 'child', parentId: 'node', label: 'Move', lastResult: 'success', lastNativeResult: 'SUCCESS' };
    const tree = { ...external, version: 4, nodes: [node, child] };
    event({ observations: [tree] });
    const unchanged = client.getState().observations[0].nodes[0];
    const delta = { id: 'external', runtime: 'btcpp', name: 'Robot mission', source: 'tcp://robot:1667', state: 'running', result: null, error: null, connected: true, updatedAt: 124 };
    event({ type: 'observation', observationDelta: { ...delta, version: 5, baseVersion: 4, changes: [{ id: 'child', status: 'running', nativeStatus: 'RUNNING', feedback: 'Moving' }] } });
    const [root, moving] = client.getState().observations[0].nodes;
    expect(root).toBe(unchanged);
    expect(moving).toEqual({ ...node, id: 'child', parentId: 'node', label: 'Move', feedback: 'Moving' }); // Result cleared.
    expect(client.getState().observations[0]).toMatchObject({ version: 5, updatedAt: 124 });
    expect(fake.topics[0].publish).not.toHaveBeenCalled();
    event({ type: 'observation', observationDelta: { ...delta, version: 7, baseVersion: 6, changes: [] } });
    expect(client.getState().observations[0].version).toBe(5);
    expect(command()).toMatchObject({ command: 'status' });
    reply({ observations: [{ ...tree, version: 7 }] });
    expect(client.getState().observations[0].version).toBe(7);
    event({ type: 'observation', observationDelta: { ...delta, version: 8, baseVersion: 7, changes: [{ id: 'unknown', status: 'idle', nativeStatus: 'IDLE', feedback: '' }] } });
    expect(client.getState().observations[0].version).toBe(7);
  });
  it('accepts observed trees larger than authored ones', () => {
    const nodes = [node, ...Array.from({ length: 5000 }, (_, i) => ({ ...node, id: `n${i}`, parentId: 'node' }))];
    event({ observations: [{ ...external, nodes }] });
    expect(client.getState().observations[0].nodes).toHaveLength(5001);
  });
  it.each([null, [{ ...node, parentId: 'missing' }], [node, node], [{ ...node, parentId: 'node' }]])('rejects malformed native telemetry topology %j', nodes => {
    event({ observation: { ...external, nodes } });
    expect(client.getState().observations).toEqual([]);
  });
});
