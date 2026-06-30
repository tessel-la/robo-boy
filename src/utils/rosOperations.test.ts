import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { executeRosOperation } from './rosOperations';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(), advertise: vi.fn(), unadvertise: vi.fn(), callService: vi.fn(),
}));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function () { return { publish: mocks.publish, advertise: mocks.advertise, unadvertise: mocks.unadvertise }; }),
    Message: vi.fn(function (value) { return value; }),
    Service: vi.fn(function () { return { callService: mocks.callService }; }),
    ServiceRequest: vi.fn(function (value) { return value; }),
  },
}));

describe('executeRosOperation', () => {
  beforeEach(() => Object.values(mocks).forEach(mock => mock.mockReset()));

  it('publishes a topic payload and releases the advertisement', async () => {
    await executeRosOperation({} as Ros, { kind: 'topic', name: '/enabled', messageType: 'std_msgs/msg/Bool', payload: { data: true } });
    expect(mocks.publish).toHaveBeenCalledWith({ data: true });
    expect(mocks.advertise).toHaveBeenCalledOnce();
    expect(mocks.unadvertise).toHaveBeenCalledOnce();
  });

  it('resolves service responses and rejects service failures', async () => {
    mocks.callService.mockImplementationOnce((_request, success) => success({ ok: true }));
    await expect(executeRosOperation({} as Ros, { kind: 'service', name: '/start', messageType: 'example/srv/Start', payload: { force: true } })).resolves.toEqual({ ok: true });
    mocks.callService.mockImplementationOnce((_request, _success, failure) => failure(new Error('no')));
    await expect(executeRosOperation({} as Ros, { kind: 'service', name: '/start', messageType: 'example/srv/Start' })).rejects.toThrow('no');
  });

  it('cancels an in-flight service operation', async () => {
    mocks.callService.mockImplementation(() => undefined);
    const controller = new AbortController();
    const operation = executeRosOperation({} as Ros, {
      kind: 'service', name: '/start', messageType: 'example/srv/Start', timeoutMs: 5000,
    }, controller.signal);
    controller.abort();
    await expect(operation).rejects.toThrow('Operation cancelled.');
  });

  it('rejects operations that are already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(executeRosOperation({} as Ros, {
      kind: 'topic', name: '/enabled', messageType: 'std_msgs/msg/Bool',
    }, controller.signal)).rejects.toThrow('Operation cancelled.');
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('resolves action results delivered by rosbridge', async () => {
    const socket = { onmessage: vi.fn() };
    const callOnConnection = vi.fn();
    const ros = { socket, callOnConnection } as unknown as Ros;
    const operation = executeRosOperation(ros, {
      kind: 'action', name: '/navigate', messageType: 'nav2_msgs/action/NavigateToPose', payload: { target: 'dock' },
    });
    const goal = callOnConnection.mock.calls[0][0];
    socket.onmessage({ data: JSON.stringify({ op: 'action_result', id: goal.id, result: true, status: 4, values: { reached: true } }) });
    await expect(operation).resolves.toEqual({ reached: true });
    expect(callOnConnection).toHaveBeenCalledWith(expect.objectContaining({ op: 'send_action_goal', action: '/navigate' }));
  });

  it('rejects failed action results and cancels aborted actions', async () => {
    const firstSocket = { onmessage: vi.fn() };
    const firstCall = vi.fn();
    const firstRos = { socket: firstSocket, callOnConnection: firstCall } as unknown as Ros;
    const failed = executeRosOperation(firstRos, { kind: 'action', name: '/navigate', messageType: 'example/action/Go' });
    const firstGoal = firstCall.mock.calls[0][0];
    firstSocket.onmessage({ data: JSON.stringify({ op: 'action_result', id: firstGoal.id, result: false, status: 6 }) });
    await expect(failed).rejects.toThrow('Action failed with status 6.');

    const secondSocket = { onmessage: vi.fn() };
    const secondCall = vi.fn();
    const secondRos = { socket: secondSocket, callOnConnection: secondCall } as unknown as Ros;
    const controller = new AbortController();
    const cancelled = executeRosOperation(secondRos, {
      kind: 'action', name: '/navigate', messageType: 'example/action/Go', timeoutMs: 5000,
    }, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow('Operation cancelled.');
    expect(secondCall).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'cancel_action_goal' }));
  });
});
