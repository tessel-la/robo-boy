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
    event({ session: { ...session, state: 'completed', result: 'success', nodes: [{ ...node, status: 'idle', lastResult: 'success', lastNativeResult: 'SUCCESS' }] } });
    event({ sequence: 1, session });
    expect(client.getState().session?.result).toBe('success');
    expect(client.getState().session?.nodes[0]).toMatchObject({ status: 'idle', lastResult: 'success' });
    expect(client.getState().logs[0].feedback).toEqual({ progress: 0.5 });
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
