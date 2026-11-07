import type { Ros } from 'roslib';
import { vi } from 'vitest';
import { CONTROL_STATUS_TOPIC, type ControlStatus } from '../features/robotControl/ControlSession';

export const panelControlStatus = (overrides: Partial<ControlStatus> = {}): ControlStatus => ({
  version: 1,
  selfId: 'self',
  owner: 'self',
  token: 'host-only-lease',
  state: 'owned',
  ready: true,
  pending: 0,
  adoptable: false,
  managing: false,
  leaseMs: 10000,
  reason: '',
  error: '',
  clients: [{ id: 'self', label: 'Me' }],
  ...overrides,
});

export const panelRosFixture = () => {
  const listeners = new Map<string, Set<(message?: unknown) => void>>();
  const socket = new EventTarget();
  const send = vi.fn();
  const ros = {
    isConnected: true,
    socket,
    callOnConnection: send,
    on: (name: string, listener: (message?: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    off: (name: string, listener: (message?: unknown) => void) => listeners.get(name)?.delete(listener),
  };
  const emit = (name: string, value?: unknown) => [...(listeners.get(name) ?? [])].forEach(listener => listener(value));
  return {
    ros: ros as unknown as Ros & { socket: EventTarget; callOnConnection: typeof send },
    send,
    socket,
    receive: (message: unknown) => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })),
    status: (overrides: Partial<ControlStatus> = {}) =>
      emit(CONTROL_STATUS_TOPIC, { data: JSON.stringify(panelControlStatus(overrides)) }),
    close: () => {
      ros.isConnected = false;
      socket.dispatchEvent(new Event('close'));
      emit('close');
    },
  };
};
