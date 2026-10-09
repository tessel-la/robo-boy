import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { ControlSession, CONTROL_STATUS_TOPIC, controlSessionFor, type ControlStatus } from './ControlSession';

import { defaultSessionName, rememberSessionName } from './sessionName';
vi.mock('./sessionName', () => ({ defaultSessionName: vi.fn(async () => undefined), rememberSessionName: vi.fn() }));

export function fakeControlRos() {
  const listeners = new Map<string, (message: unknown) => void>();
  const ros = {
    callOnConnection: vi.fn(),
    on: vi.fn((name: string, listener: (message: unknown) => void) => listeners.set(name, listener)),
    off: vi.fn((name: string) => listeners.delete(name)),
  };
  return {
    ros: ros as unknown as Ros & { callOnConnection: typeof ros.callOnConnection },
    send: ros.callOnConnection,
    status: (overrides: Partial<ControlStatus> = {}) =>
      listeners.get(CONTROL_STATUS_TOPIC)?.({
        data: JSON.stringify({
          version: 1,
          selfId: 'a',
          owner: null,
          token: null,
          state: 'available',
          ready: true,
          leaseMs: 10000,
          pending: 0,
          adoptable: false,
          managing: false,
          reason: '',
          error: '',
          clients: [
            { id: 'a', label: 'Alice' },
            { id: 'b', label: 'Bob' },
          ],
          ...overrides,
        }),
      }),
  };
}

describe('ControlSession', () => {
  beforeEach(() => {
    vi.mocked(defaultSessionName).mockReset().mockResolvedValue(undefined);
    vi.mocked(rememberSessionName).mockClear();
  });
  afterEach(() => vi.useRealTimers());
  it('keeps server status fresh in shared mode without acquiring or heartbeating', () => {
    vi.useFakeTimers();
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    for (let i = 0; i < 20; i++) {
      status({ enabled: false, idleMs: 0 });
      vi.advanceTimersByTime(1000);
    }
    expect(session.hasRecentStatus()).toBe(true);
    expect(session.getSnapshot()?.enabled).toBe(false);
    expect(send).not.toHaveBeenCalled();
    ros.callOnConnection({ op: 'publish', topic: '/cmd_vel' });
    expect(send).toHaveBeenCalledWith({
      op: 'roboboy_frame',
      message: { op: 'publish', topic: '/cmd_vel', controlToken: undefined },
    });
    for (const invalid of [{ enabled: 'false' }, { idleMs: -1 }, { idleMs: '0' }]) {
      status(invalid as unknown as Partial<ControlStatus>);
      expect(session.getSnapshot()?.enabled).toBe(false);
    }
    session.dispose();
  });
  it('starts read-only, envelopes ROSLIB writes and never falls back to raw commands', () => {
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    expect(controlSessionFor(ros)).toBe(session);
    ros.callOnConnection({ op: 'publish', topic: '/cmd_vel', controlToken: 'forged' });
    expect(send).toHaveBeenLastCalledWith({
      op: 'roboboy_frame',
      message: { op: 'publish', topic: '/cmd_vel', controlToken: undefined },
    });
    session.command('acquire');
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'acquire' }));
    status({ owner: 'a', token: 'lease', state: 'owned' });
    const captured = ros.callOnConnection;
    captured({ op: 'call_service', service: '/reset', id: 'one' });
    expect(send).toHaveBeenLastCalledWith({
      op: 'roboboy_frame',
      message: { op: 'call_service', service: '/reset', id: 'one', controlToken: 'lease' },
    });
    status({ owner: 'b', state: 'owned' });
    ros.callOnConnection({ op: 'publish', topic: '/cmd_vel' });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ controlToken: undefined }) })
    );
    session.dispose();
    expect(ros.callOnConnection).toBe(send);
    expect(controlSessionFor(ros)).toBeUndefined();
  });

  it('identifies the native user once without acquiring control', async () => {
    vi.mocked(defaultSessionName).mockResolvedValue('operator');
    const { ros, send } = fakeControlRos();
    const session = new ControlSession(ros);
    session.connected();
    await Promise.resolve();
    session.connected();
    expect(send.mock.calls.filter(([message]) => message.action === 'identify')).toHaveLength(1);
    expect(send).toHaveBeenCalledWith({ op: 'roboboy_control', action: 'identify', label: 'operator' });
    expect(send.mock.calls.some(([message]) => message.action === 'acquire')).toBe(false);
    session.dispose();
  });

  it('does not overwrite a manual name or send after disposal when native identity arrives late', async () => {
    for (const dispose of [false, true]) {
      let resolve!: (name: string) => void;
      vi.mocked(defaultSessionName).mockReturnValue(
        new Promise<string>(done => {
          resolve = done;
        })
      );
      const { ros, send } = fakeControlRos();
      const session = new ControlSession(ros);
      session.connected();
      if (dispose) session.dispose();
      else session.command('identify', { label: 'Chosen' });
      send.mockClear();
      resolve('Native');
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
      if (!dispose) session.dispose();
    }
  });

  it('remembers only server-confirmed manual names', () => {
    const { ros, status } = fakeControlRos();
    const session = new ControlSession(ros);
    session.command('identify', { label: 'Chosen' });
    status();
    expect(rememberSessionName).not.toHaveBeenCalled();
    status({ clients: [{ id: 'a', label: 'Chosen' }] });
    expect(rememberSessionName).toHaveBeenCalledExactlyOnceWith('Chosen');
    session.dispose();
  });

  it('heartbeats while status broadcasts arrive, then stops on lost ownership', () => {
    vi.useFakeTimers();
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    status({ owner: 'a', token: 'lease', state: 'owned' });
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(1000);
      status({ owner: 'a', token: 'lease', state: 'owned' });
    }
    expect(send.mock.calls.filter(([message]) => message.action === 'heartbeat')).toHaveLength(3);
    status({ state: 'draining', owner: 'a' });
    send.mockClear();
    vi.advanceTimersByTime(3000);
    expect(send).not.toHaveBeenCalled();
    session.dispose();
  });

  it('drops stale server state without automatically reacquiring control', () => {
    vi.useFakeTimers();
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    status({ owner: 'a', token: 'lease', state: 'owned' });
    vi.advanceTimersByTime(11000);
    expect(session.hasRecentStatus()).toBe(false);
    expect(session.getSnapshot()).toBeNull();
    ros.callOnConnection({ op: 'publish', topic: '/cmd_vel' });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ controlToken: undefined }) })
    );
    expect(send.mock.calls.some(([message]) => message.action === 'acquire')).toBe(false);
    session.dispose();
  });

  it('disposes timers and listeners without stopping persistent work', () => {
    vi.useFakeTimers();
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    session.connected();
    expect(send).toHaveBeenCalledWith({ op: 'subscribe', topic: CONTROL_STATUS_TOPIC });
    status({ owner: 'a', token: 'lease', state: 'owned' });
    session.dispose();
    expect(send.mock.calls.some(([message]) => message.action === 'release')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(ros.off).toHaveBeenCalledWith(CONTROL_STATUS_TOPIC, expect.any(Function));
  });
});
