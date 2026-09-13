import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import ConnectionTabs from './components/ConnectionTabs';

const lifecycle = vi.hoisted(() => ({
  mounted: vi.fn(),
  unmounted: vi.fn(),
  activation: vi.fn(),
}));

vi.mock('./components/TitleBar', () => ({ default: () => null }));
vi.mock('./features/theme/components/ThemeSelector', () => ({
  default: () => <button type="button">Theme setting</button>,
}));
vi.mock('./features/theme/components/ThemeCreator', () => ({ default: () => null }));
vi.mock('./components/EntrySection', () => ({
  default: ({ onConnect }: any) => (
    <div>
      <button type="button" onClick={() => onConnect({ ros2Option: 'ip', ros2Value: 'alpha.local' })}>
        Connect alpha
      </button>
      <button type="button" onClick={() => onConnect({ ros2Option: 'ip', ros2Value: 'beta.local' })}>
        Connect beta
      </button>
    </div>
  ),
}));
vi.mock('./components/MainControlView', () => ({
  default: function MockMainControlView({
    connectionParams,
    isActive,
    onConnectionStatusChange,
    connectionNavigation,
  }: any) {
    const target = String(connectionParams.ros2Value);
    useEffect(() => {
      lifecycle.mounted(target);
      onConnectionStatusChange('connected');
      return () => lifecycle.unmounted(target);
    }, []);
    useEffect(() => lifecycle.activation(target, isActive), [isActive, target]);
    if (!isActive) return null;
    return (
      <div>
        <div data-testid="mock-top-bar">
          <ConnectionTabs {...connectionNavigation} />
        </div>
        {`${target}:active`}
      </div>
    );
  },
}));

describe('App connection sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('keeps the theme setting in the session dropdown before the first connection', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Theme setting' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch connections, opening a new connection' }));

    const popover = screen.getByRole('dialog', { name: 'Switch robot connection' });
    expect(popover).toContainElement(screen.getByRole('button', { name: 'Theme setting' }));
  });

  it('keeps independent sessions mounted while switching and focuses duplicate targets', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect alpha' }));
    await screen.findByRole('button', { name: /Switch connections.*alpha\.local.*Connected/ });

    fireEvent.click(screen.getByRole('button', { name: /Switch connections/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open another connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect beta' }));
    await screen.findByRole('button', { name: /Switch connections.*beta\.local.*Connected/ });

    fireEvent.click(screen.getByRole('button', { name: /Switch connections/ }));
    fireEvent.click(screen.getByRole('button', { name: /alpha\.local.*Connected/ }));
    expect(screen.getByRole('button', { name: /Switch connections.*alpha\.local.*Connected/ })).toBeInTheDocument();
    expect(lifecycle.mounted).toHaveBeenCalledTimes(2);
    expect(lifecycle.unmounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Switch connections/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open another connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect alpha' }));
    expect(screen.getByRole('button', { name: /Switch connections.*alpha\.local.*Connected/ })).toBeInTheDocument();
    expect(lifecycle.mounted).toHaveBeenCalledTimes(2);
  });

  it('deactivates a tab before removing its connection owner', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect alpha' }));
    await screen.findByRole('button', { name: /Switch connections.*alpha\.local.*Connected/ });
    lifecycle.activation.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Switch connections/ }));
    fireEvent.click(screen.getByRole('button', { name: /Close alpha\.local/ }));

    expect(lifecycle.activation).toHaveBeenCalledWith('alpha.local', false);
    await waitFor(() => expect(lifecycle.unmounted).toHaveBeenCalledWith('alpha.local'));
    expect(screen.getByRole('button', { name: 'Connect alpha' })).toBeInTheDocument();
  });
});
