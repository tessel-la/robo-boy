import { useEffect, useId, useRef, useState } from 'react';
import type { ConnectionStatus } from '../runtime/connections';
import './ConnectionTabs.css';

export interface ConnectionTabItem {
  id: string;
  label: string;
  description: string;
  status: ConnectionStatus;
  isClosing?: boolean;
}

interface ConnectionTabsProps {
  tabs: ConnectionTabItem[];
  activeTabId: string | null;
  isAdding: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

const statusLabel: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
};

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4 4 8 8m0-8-8 8" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg className={`connection-switcher-chevron ${isOpen ? 'is-open' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4 6 4 4 4-4" />
  </svg>
);

export default function ConnectionTabs({ tabs, activeTabId, isAdding, onSelect, onClose, onAdd }: ConnectionTabsProps) {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const activeTab = tabs.find(tab => tab.id === activeTabId && !tab.isClosing) ?? null;

  useEffect(() => {
    if (!isSwitcherOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setIsSwitcherOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsSwitcherOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSwitcherOpen]);

  const selectConnection = (id: string) => {
    setIsSwitcherOpen(false);
    onSelect(id);
  };

  const openAnotherConnection = () => {
    setIsSwitcherOpen(false);
    onAdd();
  };

  return (
    <nav className="connection-tabs" aria-label="Robot connections" ref={navRef}>
      <button
        type="button"
        className={`connection-switcher-trigger ${isAdding ? 'is-adding' : ''}`}
        ref={triggerRef}
        onClick={() => setIsSwitcherOpen(open => !open)}
        aria-label={
          isAdding
            ? 'Switch connections, opening a new connection'
            : `Switch connections, current: ${activeTab?.description ?? 'none'}, ${activeTab ? statusLabel[activeTab.status] : 'No status'}`
        }
        aria-haspopup="dialog"
        aria-expanded={isSwitcherOpen}
        aria-controls={popoverId}
      >
        {isAdding ? (
          <span className="connection-switcher-plus" aria-hidden="true">
            <PlusIcon />
          </span>
        ) : (
          <span className={`connection-tab-status is-${activeTab?.status ?? 'disconnected'}`} aria-hidden="true" />
        )}
        <span className="connection-switcher-label">
          {isAdding ? 'New connection' : (activeTab?.label ?? 'Connections')}
        </span>
        <ChevronIcon isOpen={isSwitcherOpen} />
      </button>

      {isSwitcherOpen && (
        <div className="connection-switcher-popover" id={popoverId} role="dialog" aria-label="Switch robot connection">
          <div className="connection-switcher-heading">
            <span>Connections</span>
            <span>{tabs.length}</span>
          </div>
          <div className="connection-switcher-list">
            {tabs.map(tab => {
              const selected = !isAdding && activeTabId === tab.id;
              return (
                <div
                  className={`connection-switcher-row ${selected ? 'is-active' : ''} ${tab.isClosing ? 'is-closing' : ''}`}
                  key={tab.id}
                >
                  <button
                    type="button"
                    className="connection-switcher-select"
                    onClick={() => selectConnection(tab.id)}
                    disabled={tab.isClosing}
                    aria-current={selected ? 'page' : undefined}
                    aria-label={`${tab.description}, ${statusLabel[tab.status]}${selected ? ', current connection' : ''}`}
                  >
                    <span className={`connection-tab-status is-${tab.status}`} aria-hidden="true" />
                    <span className="connection-switcher-copy">
                      <span className="connection-switcher-name">{tab.label}</span>
                      <span className={`connection-switcher-status is-${tab.status}`}>{statusLabel[tab.status]}</span>
                    </span>
                    {selected && <span className="connection-switcher-current">Current</span>}
                  </button>
                  <button
                    type="button"
                    className="connection-switcher-close"
                    onClick={() => onClose(tab.id)}
                    disabled={tab.isClosing}
                    aria-label={`Close ${tab.description}`}
                    title={`Close ${tab.description}`}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className="connection-switcher-add" onClick={openAnotherConnection}>
            <PlusIcon />
            <span>Open another connection</span>
          </button>
        </div>
      )}
    </nav>
  );
}
