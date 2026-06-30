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
});
