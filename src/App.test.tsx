import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const lifecycle = vi.hoisted(() => ({
  mounted: vi.fn(),
  unmounted: vi.fn(),
  activation: vi.fn(),
}));

vi.mock('./components/TitleBar', () => ({ default: () => null }));
vi.mock('./features/theme/components/ThemeSelector', () => ({ default: () => null }));
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
        <div data-testid="mock-top-bar">{connectionNavigation}</div>
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

  it('keeps independent sessions mounted while switching and focuses duplicate targets', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect alpha' }));
    await screen.findByRole('tab', { name: /alpha\.local.*Connected/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open another connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect beta' }));
    await screen.findByRole('tab', { name: /beta\.local.*Connected/ });

    fireEvent.click(screen.getByRole('tab', { name: /alpha\.local.*Connected/ }));
    expect(screen.getByRole('tab', { name: /alpha\.local.*Connected/ })).toHaveAttribute('aria-selected', 'true');
    expect(lifecycle.mounted).toHaveBeenCalledTimes(2);
    expect(lifecycle.unmounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open another connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect alpha' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(lifecycle.mounted).toHaveBeenCalledTimes(2);
  });

  it('deactivates a tab before removing its connection owner', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect alpha' }));
    await screen.findByRole('tab', { name: /alpha\.local.*Connected/ });
    lifecycle.activation.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Close alpha\.local/ }));

    expect(lifecycle.activation).toHaveBeenCalledWith('alpha.local', false);
    await waitFor(() => expect(lifecycle.unmounted).toHaveBeenCalledWith('alpha.local'));
    expect(screen.getByRole('button', { name: 'Connect alpha' })).toBeInTheDocument();
  });
});
