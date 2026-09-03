import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ButtonComponent from './ButtonComponent';
import ToggleComponent from './ToggleComponent';
import type { GamepadComponentConfig } from '../types';

const executeRosOperation = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/rosOperations', () => ({ executeRosOperation }));

const operation = (name: string) => ({
  kind: 'service' as const,
  name,
  messageType: 'std_srvs/srv/Trigger',
  payload: {},
});

describe('button and toggle ROS event operations', () => {
  beforeEach(() => executeRosOperation.mockReset().mockResolvedValue({}));

  it('runs independent button press and release operations', async () => {
    const config: GamepadComponentConfig = {
      id: 'button', type: 'button', position: { x: 0, y: 0, width: 1, height: 1 },
      label: 'Launch', config: { momentary: true },
      eventOperations: { press: operation('/press'), release: operation('/release') },
    };
    render(<ButtonComponent config={config} ros={{} as any} />);
    const button = screen.getByRole('button', { name: /Launch/ });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);

    await waitFor(() => expect(executeRosOperation).toHaveBeenCalledTimes(2));
    expect(executeRosOperation.mock.calls.map(([, value]) => value.name)).toEqual(['/press', '/release']);
  });

  it('rolls a toggle back when its state operation fails', async () => {
    executeRosOperation.mockRejectedValueOnce(new Error('failed'));
    const config: GamepadComponentConfig = {
      id: 'toggle', type: 'toggle', position: { x: 0, y: 0, width: 1, height: 1 },
      label: 'Enabled', eventOperations: { on: operation('/enable'), off: operation('/disable') },
    };
    render(<ToggleComponent config={config} ros={{} as any} />);
    fireEvent.click(screen.getByText('OFF').parentElement!.querySelector('.toggle-switch')!);

    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument());
    expect(screen.getByText('OFF')).toBeInTheDocument();
  });
});
