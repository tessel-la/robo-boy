import { describe, expect, it, vi } from 'vitest';
import { ControlSession } from '../features/robotControl/ControlSession';
import { panelRosFixture } from '../test/panelRos';
import { connectPanelCapabilityBroker } from './capabilityBroker';
import type { ResolvedPanelManifest } from './types';

const manifest: ResolvedPanelManifest = {
  schemaVersion: 1,
  id: 'com.example.actions',
  name: 'Actions',
  description: 'Test',
  version: '1.0.0',
  entryPoint: 'https://example.com/panels/actions/1.0.0/index.js',
  registryUrl: 'https://example.com/panels/installed.json',
  integrity: `sha256-${'A'.repeat(43)}=`,
  compatibility: { panelApi: '^2.0.0', roboboy: '*' },
  capabilities: ['ros'],
  permissions: { ros: { actions: ['/robot/*'], control: true } },
  author: { name: 'Test' },
  repository: 'https://example.com/actions',
};
const goal = { action: '/robot/move', actionType: 'example_msgs/action/Move', goal: { target: 1 } };
const broker = (ros: ReturnType<typeof panelRosFixture>['ros'], overrides: Partial<ResolvedPanelManifest> = {}) => {
  const port = { onmessage: null, postMessage: vi.fn(), start: vi.fn(), close: vi.fn() } as unknown as MessagePort;
  const hostElement = document.createElement('div');
  const options = {
    ros,
    manifest: { ...manifest, ...overrides },
    runtime: { target: 'web' as const },
    runtimeEndpoints: {},
    hostElement,
    logger: console,
  };
  const dispose = connectPanelCapabilityBroker(port, options, vi.fn());
  return {
    port,
    options,
    hostElement,
    dispose,
    request: (requestId: string, method: string, params?: unknown) =>
      port.onmessage?.({ data: { type: 'request', requestId, method, params } } as MessageEvent),
    messages: () => vi.mocked(port.postMessage).mock.calls.map(([message]) => message),
  };
};

describe('panel action and control permission broker', () => {
  it('uses the shared lease envelope, sends scoped feedback/results, and keeps tokens out of replies', async () => {
    const { ros, status, send, receive } = panelRosFixture();
    const session = new ControlSession(ros);
    status();
    const panel = broker(ros);
    panel.request('send', 'ros.sendActionGoal', goal);
    await vi.waitFor(() =>
      expect(panel.messages()).toContainEqual(
        expect.objectContaining({ requestId: 'send', value: { goalId: expect.any(String) } })
      )
    );
    const envelope = send.mock.calls.find(([message]) => message.op === 'roboboy_frame')![0];
    expect(envelope.message).toMatchObject({
      op: 'send_action_goal',
      action: '/robot/move',
      args: { target: 1 },
      controlToken: 'host-only-lease',
    });
    const id = envelope.message.id;
    receive({ op: 'action_feedback', id, values: { progress: 0.5 } });
    expect(panel.messages()).toContainEqual({
      type: 'ros-action-feedback',
      requestId: 'send',
      value: { progress: 0.5 },
    });
    const other = broker(ros);
    other.request('foreign-cancel', 'ros.cancelActionGoal', { goalId: id });
    await vi.waitFor(() =>
      expect(other.messages()).toContainEqual(
        expect.objectContaining({ requestId: 'foreign-cancel', error: expect.any(String) })
      )
    );
    status({ owner: 'other', token: null });
    panel.request('cancel', 'ros.cancelActionGoal', { goalId: id });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ op: 'cancel_action_goal', id }) })
    );
    receive({ op: 'action_result', id, status: 5, result: true, values: { success: false } });
    await vi.waitFor(() =>
      expect(panel.messages()).toContainEqual({
        type: 'ros-action-result',
        requestId: 'send',
        value: { status: 5, result: { success: false } },
      })
    );
    expect(JSON.stringify(panel.messages())).not.toContain('host-only-lease');
    panel.dispose();
    other.dispose();
    session.dispose();
  });

  it('rejects missing capability, ungranted actions, malformed names/types/payloads before sending', async () => {
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status();
    const panel = broker(ros);
    const invalid = [
      { ...goal, action: '/other/move' },
      { ...goal, action: '/robot//move' },
      { ...goal, actionType: 'Move' },
      { ...goal, goal: { x: NaN } },
      { ...goal, goal: { data: 'x'.repeat(1024 * 1024) } },
    ];
    invalid.forEach((params, i) => panel.request(`bad-${i}`, 'ros.sendActionGoal', params));
    const noCapability = broker(ros, { capabilities: [] });
    noCapability.request('no-capability', 'ros.sendActionGoal', goal);
    const noPermission = broker(ros, { permissions: { ros: {} } });
    noPermission.request('no-permission', 'ros.sendActionGoal', goal);
    await vi.waitFor(() => expect(panel.messages().filter(message => message.error)).toHaveLength(invalid.length));
    await vi.waitFor(() => expect(noCapability.messages()[0]?.error).toContain('no ROS capability'));
    await vi.waitFor(() => expect(noPermission.messages()[0]?.error).toContain('not permitted'));
    expect(send).not.toHaveBeenCalled();
    panel.dispose();
    noCapability.dispose();
    noPermission.dispose();
    session.dispose();
  });

  it('does not auto-acquire or queue a goal for an observer or disconnected transport', async () => {
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status({ state: 'available', owner: null, token: null });
    const panel = broker(ros);
    panel.request('observer', 'ros.sendActionGoal', goal);
    await vi.waitFor(() => expect(panel.messages()[0]?.error).toContain('Request robot control'));
    status();
    ros.isConnected = false;
    panel.request('offline', 'ros.sendActionGoal', goal);
    await vi.waitFor(() => expect(panel.messages()[1]?.error).toContain('ROS is unavailable'));
    expect(send).not.toHaveBeenCalled();
    panel.dispose();
    session.dispose();
  });

  it('checks control permission, activation and panel focus in the trusted host', async () => {
    const activation = Object.getOwnPropertyDescriptor(navigator, 'userActivation');
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });
    const { ros, send, status } = panelRosFixture();
    const session = new ControlSession(ros);
    status({ state: 'available', owner: null, token: null });
    const panel = broker(ros);
    const denied = broker(ros, { permissions: { ros: { control: false } } });
    try {
      denied.request('permission', 'ros.control.request');
      panel.request('no-gesture', 'ros.control.request');
      await vi.waitFor(() => expect(denied.messages()[0]?.error).toContain('not permitted'));
      await vi.waitFor(() => expect(panel.messages()[0]?.error).toContain('user gesture'));
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } });
      panel.request('wrong-focus', 'ros.control.request');
      await vi.waitFor(() => expect(panel.messages()[1]?.error).toContain('user gesture'));
      expect(send).not.toHaveBeenCalled();
      document.body.append(panel.hostElement);
      panel.hostElement.tabIndex = 0;
      panel.hostElement.focus();
      panel.request('request', 'ros.control.request');
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'acquire' }))
      );
      status();
      await vi.waitFor(() =>
        expect(panel.messages()).toContainEqual({
          type: 'response',
          requestId: 'request',
          value: { state: 'owned', message: expect.any(String) },
        })
      );
      expect(JSON.stringify(panel.messages())).not.toContain('host-only-lease');
    } finally {
      panel.dispose();
      denied.dispose();
      session.dispose();
      panel.hostElement.remove();
      if (activation) Object.defineProperty(navigator, 'userActivation', activation);
      else Reflect.deleteProperty(navigator, 'userActivation');
    }
  });
});
