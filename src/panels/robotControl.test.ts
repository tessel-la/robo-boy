import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlSession } from '../features/robotControl/ControlSession';
import { panelRosFixture } from '../test/panelRos';
import { requestPanelRobotControl, requirePanelRobotControl } from './robotControl';

afterEach(() => vi.useRealTimers());

describe('panel requests for the shared control lease', () => {
  it('acquires only after an explicit request and keeps lease tokens in the host', async () => {
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status({ state: 'available', owner: null, token: null });
    expect(send).not.toHaveBeenCalled();
    expect(() => requirePanelRobotControl(ros)).toThrow('Request robot control');
    const request = requestPanelRobotControl(ros, new AbortController().signal);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ op: 'roboboy_control', action: 'acquire' }));
    status();
    await expect(request).resolves.toEqual({ state: 'owned', message: expect.any(String) });
    expect(() => requirePanelRobotControl(ros)).not.toThrow();
    session.dispose();
  });

  it('asks the current owner for consent without acquiring, adopting or transferring', async () => {
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status({ owner: 'other', token: null });
    const request = requestPanelRobotControl(ros, new AbortController().signal);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'request' }));
    status({ owner: 'other', token: null, request: { id: 'consent', state: 'pending', message: 'Waiting for owner' } });
    await expect(request).resolves.toEqual({ state: 'pending', message: 'Waiting for owner' });
    expect(() => requirePanelRobotControl(ros)).toThrow('Request robot control');
    await expect(requestPanelRobotControl(ros, new AbortController().signal)).resolves.toMatchObject({
      state: 'pending',
    });
    expect(send).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it('supports shared control without acquisition and obeys robot-side blocking', async () => {
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status({ enabled: false, owner: null, token: null, state: 'available' });
    expect(() => requirePanelRobotControl(ros)).not.toThrow();
    await expect(requestPanelRobotControl(ros, new AbortController().signal)).resolves.toMatchObject({
      state: 'owned',
    });
    expect(send).not.toHaveBeenCalled();
    status({
      enabled: false,
      external: { enabled: true, ready: true, allowControl: false, reason: 'Pendant disabled access' },
    });
    expect(() => requirePanelRobotControl(ros)).toThrow('Pendant disabled access');
    await expect(requestPanelRobotControl(ros, new AbortController().signal)).rejects.toThrow(
      'Pendant disabled access'
    );
    session.dispose();
  });

  it('fails closed for missing/stale gateways, recovery fences and persistent-run management', async () => {
    vi.useFakeTimers();
    const { ros, send, status } = panelRosFixture();
    expect(() => requirePanelRobotControl(ros)).toThrow('gateway is unavailable');
    const session = new ControlSession(ros);
    for (const overrides of [
      { ready: false },
      { state: 'blocked' as const },
      { state: 'draining' as const },
      { managing: true },
    ]) {
      status(overrides);
      expect(() => requirePanelRobotControl(ros)).toThrow();
      await expect(requestPanelRobotControl(ros, new AbortController().signal)).rejects.toThrow();
    }
    status();
    vi.advanceTimersByTime(10000);
    expect(() => requirePanelRobotControl(ros)).toThrow('gateway is unavailable');
    expect(send.mock.calls.filter(([message]) => message.action === 'acquire')).toHaveLength(0);
    session.dispose();
  });

  it('cleans up aborted and timed-out requests without retrying or running a command', async () => {
    vi.useFakeTimers();
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status({ state: 'available', owner: null, token: null });
    const abort = new AbortController();
    const request = requestPanelRobotControl(ros, abort.signal);
    abort.abort();
    await expect(request).rejects.toThrow('cancelled');
    const timedOut = requestPanelRobotControl(ros, new AbortController().signal);
    vi.advanceTimersByTime(5000);
    await expect(timedOut).rejects.toThrow('Nothing was run');
    expect(send).toHaveBeenCalledTimes(2);
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
