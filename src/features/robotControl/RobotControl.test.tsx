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
  it('confirms a name only after the gateway acknowledges it and clears confirmation when edited or disconnected', () => {
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    const view = render(<RobotControl ros={ros} />);
    act(() => status());
    expect(screen.getByLabelText('Session name')).toHaveValue('Alice');
    expect(screen.getByText('Name saved as Alice.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: '  Charlie  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set name' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'identify', label: 'Charlie' }));
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument();
    act(() => status({ error: 'Name rejected.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name rejected.');
    expect(screen.getByText('Current name: Alice')).toBeInTheDocument();
    act(() =>
      status({
        clients: [
          { id: 'a', label: 'Charlie' },
          { id: 'b', label: 'Bob' },
        ],
      })
    );
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.getByText('Name saved as Charlie.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Dana' } });
    expect(screen.getByRole('button', { name: 'Set name' })).toBeEnabled();
    expect(screen.getByText('Current name: Charlie')).toBeInTheDocument();
    act(() => session.dispose());
    expect(screen.queryByText('Current name: Charlie')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set name' })).toBeDisabled();
    view.unmount();
  });

  it('shows robot-side policy and waits for approval without allowing local bypass', () => {
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    const view = render(<RobotControl ros={ros} />);
    act(() =>
      status({ external: { enabled: true, ready: true, allowControl: false, reason: 'Disabled on the robot.' } })
    );
    expect(screen.getByText('Disabled on the robot.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request control' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'acquire' }));
    act(() =>
      status({
        external: { enabled: true, ready: true, allowControl: false, reason: 'Disabled on the robot.' },
        request: { id: 'robot-request', state: 'pending', message: 'Waiting for robot-side approval.' },
      })
    );
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled();
    expect(screen.getByText('Waiting for robot-side approval.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable control' })).not.toBeInTheDocument();
    act(() =>
      status({ external: { enabled: true, ready: false, allowControl: false, reason: 'Policy disconnected.' } })
    );
    expect(screen.getByRole('button', { name: 'Request control' })).toBeDisabled();
    view.unmount();
    session.dispose();
  });

  it('lets an observer request a held lease and see or cancel the pending decision', () => {
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    const view = render(<RobotControl ros={ros} />);
    act(() => status({ owner: 'b', ownerLabel: 'Bob', state: 'owned' }));
    fireEvent.click(screen.getByRole('button', { name: 'Request control' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'request' }));
    act(() =>
      status({ owner: 'b', state: 'owned', request: { id: 'r', state: 'pending', message: 'Waiting for Bob.' } })
    );
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled();
    expect(screen.getByText('Waiting for Bob.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel_request', requestId: 'r' }));
    act(() =>
      status({
        owner: 'b',
        state: 'owned',
        request: { id: 'r', state: 'denied', message: 'Bob denied your control request.' },
      })
    );
    expect(screen.getByText('Bob denied your control request.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request control' })).toBeEnabled();
    view.unmount();
    session.dispose();
  });

  it('notifies the owner once per request and offers safe grant or deny controls', () => {
    const { ros, send, status } = fakeControlRos();
    const session = new ControlSession(ros);
    const view = render(<RobotControl ros={ros} />);
    const requests = [{ id: 'r', clientId: 'b', label: 'Bob' }];
    act(() => status({ owner: 'a', token: 'lease', state: 'owned', requests, pending: 1 }));
    expect(view.container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Grant control to Bob' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny control to Bob' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close robot control' }));
    act(() => status({ owner: 'a', token: 'lease', state: 'owned', requests }));
    expect(view.container.querySelector('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Deny control to Bob' }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'deny', requestId: 'r', token: 'lease' }));
    act(() =>
      status({ owner: 'a', token: 'lease', state: 'owned', requests: [{ id: 'new', clientId: 'b', label: 'Bob' }] })
    );
    expect(view.container.querySelector('details')).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Grant control to Bob' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'approve', requestId: 'new', token: 'lease' })
    );
    view.unmount();
    session.dispose();
  });

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
    expect(screen.getByRole('alert')).toHaveTextContent('Bob has control.');
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
