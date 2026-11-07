import type { Ros } from 'roslib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlSession, CONTROL_STATUS_TOPIC } from '../robotControl/ControlSession';
import { applyNodeParameters, loadNodeParameters } from './parameterClient';
import type { NodeParameter, ParameterDescriptor } from './parametersModel';

type Frame = {
  op: string;
  id: string;
  service: string;
  args: Record<string, unknown>;
  type?: string;
  controlToken?: string;
};
const descriptor: ParameterDescriptor = {
  name: 'speed',
  type: 3,
  description: 'Speed limit',
  additional_constraints: '',
  read_only: false,
  dynamic_typing: false,
  floating_point_range: [{ from_value: 0, to_value: 5, step: 0 }],
  integer_range: [],
};
const original: NodeParameter = { name: 'speed', type: 3, value: 1, descriptor };
const sessions: ControlSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach(session => session.dispose());
  vi.useRealTimers();
});

function robot({ atomic = true, failWrite = false, hold = '' } = {}) {
  const listeners = new Map<string, Set<(value: any) => void>>();
  const frames: Frame[] = [];
  let speed = 1;
  const emit = (event: string, value: unknown) =>
    [...(listeners.get(event) ?? [])].forEach(listener => listener(value));
  const ros = {
    isConnected: true,
    on: (name: string, listener: (value: any) => void) =>
      listeners.set(name, (listeners.get(name) ?? new Set()).add(listener)),
    off: (name: string, listener: (value: any) => void) => listeners.get(name)?.delete(listener),
    callOnConnection: (input: Frame | { message: Frame }) => {
      const frame = 'message' in input ? input.message : input;
      if (frame.op !== 'call_service') return;
      frames.push(frame);
      if (frame.service === hold) return;
      let values: unknown;
      if (frame.service.endsWith('/list_parameters')) values = { result: { names: ['speed'] } };
      else if (frame.service.endsWith('/get_parameters')) values = { values: [{ type: 3, double_value: speed }] };
      else if (frame.service.endsWith('/describe_parameters')) values = { descriptors: [descriptor] };
      else if (frame.service === '/rosapi/node_details')
        values = { services: [`/controller/${atomic ? 'set_parameters_atomically' : 'set_parameters'}`] };
      else
        values = atomic
          ? { result: { successful: true, reason: '' } }
          : { results: [{ successful: false, reason: 'Hardware limit' }] };
      queueMicrotask(() =>
        emit(frame.id, {
          result: !(failWrite && frame.service.includes('/set_parameters')),
          values: failWrite && frame.service.includes('/set_parameters') ? 'Transport failed' : values,
        })
      );
    },
  };
  const connection = ros as unknown as Ros;
  const control = new ControlSession(connection);
  sessions.push(control);
  const status = (owner = true) =>
    emit(CONTROL_STATUS_TOPIC, {
      data: JSON.stringify({
        version: 1,
        selfId: 'a',
        owner: owner ? 'a' : null,
        token: owner ? 'lease' : null,
        state: owner ? 'owned' : 'available',
        ready: true,
        pending: 0,
        adoptable: false,
        managing: false,
        leaseMs: 10000,
        reason: '',
        error: '',
        clients: [{ id: 'a', label: 'Test' }],
      }),
    });
  status();
  return {
    ros: connection,
    frames,
    listeners,
    emit,
    status,
    speed: (value: number) => {
      speed = value;
    },
  };
}
const signal = () => new AbortController().signal;
const draft = () => ({ speed: { original, value: 2 } });

describe('native parameter transport', () => {
  it('reads values/descriptors and discovers update mode without writing or acquiring control', async () => {
    const fake = robot();
    fake.status(false);
    const result = await loadNodeParameters(fake.ros, '/controller', signal());
    expect(result).toMatchObject({ parameters: [original], total: 1, atomic: true, writable: true });
    expect(fake.frames.every(frame => frame.op === 'call_service' && !frame.service.includes('/set_parameters'))).toBe(
      true
    );
    expect(
      [...fake.listeners].filter(([name]) => name.startsWith('parameters-')).every(([, listeners]) => !listeners.size)
    ).toBe(true);
  });

  it('preflights values and sends exactly one atomic update through the control envelope', async () => {
    const fake = robot();
    expect(await applyNodeParameters(fake.ros, '/controller', draft(), true, signal())).toEqual([
      { name: 'speed', successful: true, reason: '' },
    ]);
    const writes = fake.frames.filter(frame => frame.service.includes('/set_parameters'));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      type: 'rcl_interfaces/srv/SetParametersAtomically',
      controlToken: 'lease',
      args: { parameters: [{ name: 'speed', value: { type: 3, double_value: 2 } }] },
    });
  });

  it('reports non-atomic rejection per parameter and never falls back or retries a failed write', async () => {
    const nonAtomic = robot({ atomic: false });
    expect(await applyNodeParameters(nonAtomic.ros, '/controller', draft(), false, signal())).toEqual([
      { name: 'speed', successful: false, reason: 'Hardware limit' },
    ]);
    const failed = robot({ failWrite: true });
    await expect(applyNodeParameters(failed.ros, '/controller', draft(), true, signal())).rejects.toThrow(
      'Transport failed'
    );
    expect(failed.frames.filter(frame => frame.service.includes('/set_parameters'))).toHaveLength(1);
  });

  it('refuses writes for observers, protected policy nodes and changed values', async () => {
    const fake = robot();
    fake.status(false);
    await expect(applyNodeParameters(fake.ros, '/controller', draft(), true, signal())).rejects.toThrow(
      'Request control'
    );
    fake.status();
    await expect(
      applyNodeParameters(fake.ros, '/roboboy/control/external/controller', draft(), true, signal())
    ).rejects.toThrow('read-only');
    fake.speed(3);
    await expect(applyNodeParameters(fake.ros, '/controller', draft(), true, signal())).rejects.toThrow(
      'live value changed'
    );
    expect(fake.frames.some(frame => frame.service.includes('/set_parameters'))).toBe(false);
  });

  it('aborts caller waits, keeps an in-flight queue slot and cleans up after timeout', async () => {
    vi.useFakeTimers();
    const fake = robot({ hold: '/controller/list_parameters' });
    const controller = new AbortController();
    const first = loadNodeParameters(fake.ros, '/controller', controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    const second = loadNodeParameters(fake.ros, '/other', signal());
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.frames).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(8000);
    await second;
    expect(
      [...fake.listeners].filter(([name]) => name.startsWith('parameters-')).every(([, listeners]) => !listeners.size)
    ).toBe(true);
  });

  it('does not send a write if ownership is revoked during preflight', async () => {
    const fake = robot({ hold: '/rosapi/node_details' });
    const promise = applyNodeParameters(fake.ros, '/controller', draft(), true, signal());
    await vi.waitFor(() => expect(fake.frames[fake.frames.length - 1]?.service).toBe('/rosapi/node_details'));
    const frame = fake.frames[fake.frames.length - 1]!;
    fake.status(false);
    fake.emit(frame.id, { result: true, values: { services: ['/controller/set_parameters_atomically'] } });
    await expect(promise).rejects.toThrow('Request control');
    expect(fake.frames.some(frame => frame.service.includes('/set_parameters'))).toBe(false);
  });

  it('requires a new review if atomic update support changes', async () => {
    const fake = robot({ atomic: false });
    await expect(applyNodeParameters(fake.ros, '/controller', draft(), true, signal())).rejects.toThrow(
      'update service changed'
    );
    expect(fake.frames.some(frame => frame.service.includes('/set_parameters'))).toBe(false);
  });
});
