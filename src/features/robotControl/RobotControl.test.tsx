import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { CONTROL_STATUS_TOPIC, type ControlStatus } from './ControlSession';
import { ControlSession } from './ControlSession';
function fakeControlRos() {
  let listener: (value: unknown) => void = () => {};
  const ros = {
    callOnConnection: vi.fn(),
    off: vi.fn(),
    on: vi.fn((name, callback) => {
      if (name === CONTROL_STATUS_TOPIC) listener = callback;
    }),
  };
  return {
    ros: ros as unknown as Ros,
    send: ros.callOnConnection,
    status: (overrides: Partial<ControlStatus> = {}) =>
      listener({
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
import { RobotControl } from './RobotControl';

describe('RobotControl', () => {
  it('shows ownership, blocked command reasons, request and transfer controls', () => {
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    const view = render(<RobotControl ros={ros} />);
    expect(screen.getByText(/Control gateway unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request control' })).toBeDisabled();
    act(() => status());
    fireEvent.click(screen.getByRole('button', { name: 'Request control' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'acquire' }));
    act(() => status({ owner: 'b', ownerLabel: 'Bob', state: 'owned', error: 'Bob has control.' }));
    expect(screen.getByText('Command blocked: Bob has control.')).toBeInTheDocument();
    expect(screen.getByText(/Read-only · Bob has control/)).toBeInTheDocument();
    act(() => status({ owner: 'a', token: 'lease', state: 'owned', pending: 1 }));
    fireEvent.change(screen.getByLabelText('Transfer to'), { target: { value: 'b' } });
    expect(screen.getByRole('button', { name: 'Transfer control' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Release control and stop work' })).toBeEnabled();
    act(() => status({ owner: 'a', token: 'lease', state: 'owned' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer control' }));
    expect(send).toHaveBeenLastCalledWith({ op: 'roboboy_control', action: 'transfer', token: 'lease', target: 'b' });
    act(() => status({ owner: 'a', state: 'draining', reason: 'Waiting for action cancellation.' }));
    expect(screen.getByText('Waiting for action cancellation.')).toBeInTheDocument();
    act(() => status({ state: 'draining', adoptable: true, reason: 'Persistent tree running.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage running tree' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'adopt' }));
    view.unmount();
    session.dispose();
  });
});
