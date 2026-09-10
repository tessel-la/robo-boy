import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConnectionTabs from './ConnectionTabs';

const tabs = [
  { id: 'alpha', label: 'alpha.local', description: 'Alpha robot', status: 'connected' as const },
  { id: 'beta', label: 'beta.local', description: 'Beta robot', status: 'disconnected' as const },
];

describe('ConnectionTabs', () => {
  it('selects, closes, and opens connections independently', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onAdd = vi.fn();
    render(
      <ConnectionTabs
        tabs={tabs}
        activeTabId="alpha"
        isAdding={false}
        onSelect={onSelect}
        onClose={onClose}
        onAdd={onAdd}
      />
    );

    const trigger = screen.getByRole('button', {
      name: 'Switch connections, current: Alpha robot, Connected',
    });
    fireEvent.click(trigger);
    let popover = screen.getByRole('dialog', { name: 'Switch robot connection' });
    fireEvent.click(within(popover).getByRole('button', { name: 'Beta robot, Disconnected' }));

    fireEvent.click(trigger);
    popover = screen.getByRole('dialog', { name: 'Switch robot connection' });
    fireEvent.click(within(popover).getByRole('button', { name: 'Close Alpha robot' }));
    fireEvent.click(within(popover).getByRole('button', { name: 'Open another connection' }));

    expect(onSelect).toHaveBeenCalledWith('beta');
    expect(onClose).toHaveBeenCalledWith('alpha');
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('shows when the connection screen is active', () => {
    render(
      <ConnectionTabs tabs={tabs} activeTabId="alpha" isAdding onSelect={vi.fn()} onClose={vi.fn()} onAdd={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Switch connections, opening a new connection' })).toHaveTextContent(
      'New connection'
    );
  });

  it('offers a compact switcher with current state and all connection statuses', () => {
    const onSelect = vi.fn();
    render(
      <ConnectionTabs
        tabs={tabs}
        activeTabId="alpha"
        isAdding={false}
        onSelect={onSelect}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', {
      name: 'Switch connections, current: Alpha robot, Connected',
    });
    expect(trigger).toHaveTextContent('alpha.local');
    fireEvent.click(trigger);

    const popover = screen.getByRole('dialog', { name: 'Switch robot connection' });
    expect(within(popover).getByText('Connected')).toBeInTheDocument();
    expect(within(popover).getByText('Disconnected')).toBeInTheDocument();
    expect(within(popover).getByText('Current')).toBeInTheDocument();

    fireEvent.click(within(popover).getByRole('button', { name: 'Beta robot, Disconnected' }));
    expect(onSelect).toHaveBeenCalledWith('beta');
    expect(screen.queryByRole('dialog', { name: 'Switch robot connection' })).not.toBeInTheDocument();
  });

  it('supports add, close, outside-click, and Escape actions in the compact switcher', () => {
    const onClose = vi.fn();
    const onAdd = vi.fn();
    render(
      <div>
        <ConnectionTabs
          tabs={tabs}
          activeTabId="alpha"
          isAdding={false}
          onSelect={vi.fn()}
          onClose={onClose}
          onAdd={onAdd}
        />
        <button type="button">Outside</button>
      </div>
    );

    const trigger = screen.getByRole('button', { name: /Switch connections, current/ });
    fireEvent.click(trigger);
    let popover = screen.getByRole('dialog', { name: 'Switch robot connection' });
    fireEvent.click(within(popover).getByRole('button', { name: 'Close Beta robot' }));
    expect(onClose).toHaveBeenCalledWith('beta');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog', { name: 'Switch robot connection' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Switch robot connection' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    popover = screen.getByRole('dialog', { name: 'Switch robot connection' });
    fireEvent.click(within(popover).getByRole('button', { name: 'Open another connection' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
