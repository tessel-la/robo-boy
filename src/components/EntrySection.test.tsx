import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntrySection from './EntrySection';
import { RECENT_CONNECTIONS_STORAGE_KEY } from '../runtime/recentConnections';

vi.mock('animejs', () => ({
  default: Object.assign(
    vi.fn(() => ({ pause: vi.fn(), add: vi.fn() })),
    {
      timeline: vi.fn(() => ({ add: vi.fn().mockReturnThis(), pause: vi.fn() })),
    }
  ),
}));

vi.mock('../utils/animations', () => ({
  animateAdvancedForm: vi.fn(),
  animateButtonPress: vi.fn(),
  animateLandingPage: vi.fn(),
}));

describe('EntrySection recent connections', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('connects to a recent host', () => {
    localStorage.setItem(
      RECENT_CONNECTIONS_STORAGE_KEY,
      JSON.stringify([{ host: 'robot.tailnet.ts.net', lastConnectedAt: 10 }])
    );
    const onConnect = vi.fn();

    render(<EntrySection onConnect={onConnect} />);
    fireEvent.click(screen.getByTitle('Connect to robot.tailnet.ts.net'));

    expect(onConnect).toHaveBeenCalledWith({
      ros2Option: 'ip',
      ros2Value: 'robot.tailnet.ts.net',
      rosbridgePort: '9090',
      videoStreamPort: '8080',
      meshResourcesPort: '8000',
    });
  });

  it('connects to a recent host with its saved service ports', () => {
    localStorage.setItem(
      RECENT_CONNECTIONS_STORAGE_KEY,
      JSON.stringify([
        {
          host: 'robot.tailnet.ts.net',
          rosbridgePort: '19090',
          videoStreamPort: '18080',
          meshResourcesPort: '18000',
          lastConnectedAt: 10,
        },
      ])
    );
    const onConnect = vi.fn();

    render(<EntrySection onConnect={onConnect} />);
    fireEvent.click(screen.getByTitle('Connect to robot.tailnet.ts.net'));

    expect(onConnect).toHaveBeenCalledWith({
      ros2Option: 'ip',
      ros2Value: 'robot.tailnet.ts.net',
      rosbridgePort: '19090',
      videoStreamPort: '18080',
      meshResourcesPort: '18000',
    });
  });

  it('submits the selected service ports from the advanced form', () => {
    const onConnect = vi.fn();

    render(<EntrySection onConnect={onConnect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Options' }));
    fireEvent.change(screen.getByLabelText('Host or IP:'), { target: { value: 'robot.tailnet.ts.net' } });
    fireEvent.change(screen.getByLabelText('ROS'), { target: { value: '19,090' } });
    fireEvent.change(screen.getByLabelText('Video'), { target: { value: '18,080' } });
    fireEvent.change(screen.getByLabelText('Mesh'), { target: { value: '18,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith({
      ros2Option: 'ip',
      ros2Value: 'robot.tailnet.ts.net',
      rosbridgePort: '19090',
      videoStreamPort: '18080',
      meshResourcesPort: '18000',
    });
  });

  it('removes a recent host from the landing screen', () => {
    localStorage.setItem(
      RECENT_CONNECTIONS_STORAGE_KEY,
      JSON.stringify([{ host: 'robot.tailnet.ts.net', lastConnectedAt: 10 }])
    );

    render(<EntrySection onConnect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove robot.tailnet.ts.net' }));

    expect(screen.queryByTitle('Connect to robot.tailnet.ts.net')).not.toBeInTheDocument();
  });
});
