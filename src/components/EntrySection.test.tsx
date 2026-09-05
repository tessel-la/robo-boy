import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const packagedApp = window as typeof window & { __TAURI_INTERNALS__?: unknown };

/** The packaged shell, which unlike a browser was not served from any host. */
const runPackaged = () => {
  packagedApp.__TAURI_INTERNALS__ = {};
};

describe('EntrySection connection target', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete packagedApp.__TAURI_INTERNALS__;
  });

  it('asks the packaged app for a host rather than offering localhost', () => {
    runPackaged();

    render(<EntrySection onConnect={vi.fn()} />);

    expect(screen.queryByText('Quick Connect')).not.toBeInTheDocument();
    expect(screen.getByText(/Enter the address of the computer running the ROS stack/)).toBeInTheDocument();
    // The form that asks for one is the screen, so there is no advanced pane to open first.
    expect(screen.getByLabelText('Host or IP:')).toBeVisible();
    expect(screen.queryByTitle('Advanced Options')).not.toBeInTheDocument();
  });

  it('connects the packaged app to the host it asked for', () => {
    runPackaged();
    const onConnect = vi.fn();

    render(<EntrySection onConnect={onConnect} />);
    fireEvent.change(screen.getByLabelText('Host or IP:'), { target: { value: '192.168.1.42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith({
      ros2Option: 'ip',
      ros2Value: '192.168.1.42',
      rosbridgePort: '9090',
      videoStreamPort: '8080',
      meshResourcesPort: '8000',
    });
  });

  it('offers the last host that worked once the packaged app has one', () => {
    localStorage.setItem(
      RECENT_CONNECTIONS_STORAGE_KEY,
      JSON.stringify([{ host: 'robot.local', lastConnectedAt: 10 }])
    );
    runPackaged();

    render(<EntrySection onConnect={vi.fn()} />);

    // The host also appears in the Recent list, so name the button rather than the text.
    expect(screen.getByRole('button', { name: /Quick Connect/ })).toHaveTextContent('robot.local');
    expect(screen.queryByText(/Enter the address of the computer/)).not.toBeInTheDocument();
  });

  it('still offers the page it was served from in a browser', () => {
    render(<EntrySection onConnect={vi.fn()} />);

    expect(screen.getByText('Quick Connect')).toBeInTheDocument();
    expect(screen.getByTitle(`Connect to ${window.location.hostname}`)).toBeInTheDocument();
  });
});

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
