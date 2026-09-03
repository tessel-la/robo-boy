import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import RosEventOperationsEditor from './RosEventOperationsEditor';

const discoverAllROSResources = vi.hoisted(() => vi.fn());

vi.mock('../../behaviorTree/services/rosDiscovery', () => ({ discoverAllROSResources }));

describe('RosEventOperationsEditor', () => {
  beforeEach(() => {
    discoverAllROSResources.mockReset();
    discoverAllROSResources.mockResolvedValue({
      topics: [{ name: '/enabled', type: 'std_msgs/msg/Bool' }],
      services: [{ name: '/start', type: 'example/srv/Start' }],
      actions: [{ name: '/navigate', type: 'nav2_msgs/action/NavigateToPose' }],
    });
  });

  it('configures a discovered service operation and parses its request', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RosEventOperationsEditor events={['press']} value={{}} ros={{} as Ros} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Configure Press' }));
    expect(onChange).toHaveBeenCalledWith({
      press: { kind: 'topic', name: '', messageType: '', payload: {} },
    });

    const value = { press: { kind: 'service' as const, name: '', messageType: '', payload: {} } };
    rerender(<RosEventOperationsEditor events={['press']} value={value} ros={{} as Ros} onChange={onChange} />);
    await waitFor(() => expect(discoverAllROSResources).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('/resource_name'), { target: { value: '/start' } });
    expect(onChange).toHaveBeenLastCalledWith({
      press: expect.objectContaining({ name: '/start', messageType: 'example/srv/Start' }),
    });

    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '1500' } });
    expect(onChange).toHaveBeenLastCalledWith({ press: expect.objectContaining({ timeoutMs: 1500 }) });

    const payload = screen.getByLabelText('Payload JSON');
    fireEvent.change(payload, { target: { value: '{"force":true}' } });
    fireEvent.blur(payload);
    expect(onChange).toHaveBeenLastCalledWith({ press: expect.objectContaining({ payload: { force: true } }) });
  });

  it('switches operation kinds, reports bad JSON, and removes an event', () => {
    const onChange = vi.fn();
    render(
      <RosEventOperationsEditor
        events={['on', 'off']}
        value={{ on: { kind: 'topic', name: '/enabled', messageType: 'std_msgs/msg/Bool', payload: { data: true } } }}
        ros={null}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Call type'), { target: { value: 'action' } });
    expect(onChange).toHaveBeenCalledWith({
      on: expect.objectContaining({ kind: 'action', name: '', messageType: '' }),
    });

    const payload = screen.getByLabelText('Payload JSON');
    fireEvent.change(payload, { target: { value: '{bad' } });
    fireEvent.blur(payload);
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove ON operation' }));
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole('button', { name: '+ Configure OFF' }));
    expect(onChange).toHaveBeenLastCalledWith({
      on: expect.any(Object),
      off: { kind: 'topic', name: '', messageType: '', payload: {} },
    });
  });

  it('does not update resources after unmount', async () => {
    let resolveDiscovery: (value: unknown) => void = () => undefined;
    discoverAllROSResources.mockReturnValue(
      new Promise(resolve => {
        resolveDiscovery = resolve;
      })
    );
    const { unmount } = render(
      <RosEventOperationsEditor events={['press']} value={{}} ros={{} as Ros} onChange={vi.fn()} />
    );
    unmount();
    resolveDiscovery({ topics: [], services: [], actions: [] });
    await Promise.resolve();
  });
});
