import React, { useState, useRef, useEffect } from 'react';
import { BehaviorTree } from '../types';
import {
  listBehaviorTrees,
  loadBehaviorTree,
  deleteBehaviorTree,
  importBehaviorTree,
} from '../storage/treeStorage';
import './BehaviorTreeToolbar.css';

interface BehaviorTreeToolbarProps {
  currentTree: BehaviorTree | null;
  isExecuting: boolean;
  isPaletteCollapsed: boolean;
  selectedNodeCount: number;
  onSave: () => void;
  onLoad: (tree: BehaviorTree) => void;
  onNew: () => void;
  onExecute: () => void;
  onStop: () => void;
  onExport: () => void;
  onTogglePalette: () => void;
  onDeleteSelected: () => void;
  onRename: (name: string) => void;
}

const BehaviorTreeToolbar: React.FC<BehaviorTreeToolbarProps> = ({
  currentTree,
  isExecuting,
  isPaletteCollapsed,
  selectedNodeCount,
  onSave,
  onLoad,
  onNew,
  onExecute,
  onStop,
  onExport,
  onTogglePalette,
  onDeleteSelected,
  onRename,
}) => {
  const [menuOpen, setMenuOpen]       = useState(false);
  const [savedTrees, setSavedTrees]   = useState(listBehaviorTrees());
  const [nameValue, setNameValue]     = useState(currentTree?.name ?? '');
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // Sync local name whenever the active tree changes
  useEffect(() => {
    setNameValue(currentTree?.name ?? '');
  }, [currentTree?.id, currentTree?.name]);

  const openMenu = () => {
    setSavedTrees(listBehaviorTrees());
    setMenuOpen(true);
  };

  const closeMenu = () => setMenuOpen(false);

  const handleSave = () => {
    onSave();
    setSavedTrees(listBehaviorTrees());
  };

  const handleLoad = (treeId: string) => {
    const tree = loadBehaviorTree(treeId);
    if (tree) { onLoad(tree); closeMenu(); }
  };

  const handleDelete = (treeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this behavior tree?')) {
      deleteBehaviorTree(treeId);
      setSavedTrees(listBehaviorTrees());
    }
  };

  const handleNew = () => { onNew(); closeMenu(); };

  const handleImport = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const tree = await importBehaviorTree(file);
      if (tree) { onLoad(tree); closeMenu(); }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleNameCommit = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== currentTree?.name) onRename(trimmed);
  };

  const displayName = currentTree?.name ?? 'Untitled';

  return (
    <>
      {/* ── Compact toolbar ─────────────────────────────────────── */}
      <div className="bt-toolbar">
        <div className="bt-toolbar-start">
          {/* Menu — three bars + label */}
          <button
            className="bt-icon-btn bt-menu-btn"
            onClick={openMenu}
            title="Menu: save, load, rename"
            aria-label="Open menu"
          >
            <svg width="22" height="16" viewBox="0 0 22 16" fill="currentColor" aria-hidden="true">
              <rect y="0"  width="22" height="2.5" rx="1.25"/>
              <rect y="7"  width="22" height="2.5" rx="1.25"/>
              <rect y="14" width="22" height="2.5" rx="1.25"/>
            </svg>
            <span className="bt-icon-label">MENU</span>
          </button>

          {/* Palette toggle (mobile only) — node-graph icon, clearly distinct */}
          <button
            className={`bt-icon-btn bt-palette-toggle${isPaletteCollapsed ? '' : ' active'}`}
            onClick={onTogglePalette}
            title={isPaletteCollapsed ? 'Open node palette' : 'Close node palette'}
            aria-label="Toggle node palette"
          >
            {/* Node-graph icon: three circles connected by lines */}
            <svg width="22" height="20" viewBox="0 0 22 20" fill="currentColor" aria-hidden="true">
              <circle cx="11" cy="3"  r="2.5" fill="currentColor"/>
              <circle cx="3"  cy="17" r="2.5" fill="currentColor"/>
              <circle cx="19" cy="17" r="2.5" fill="currentColor"/>
              <line x1="11" y1="5.5"  x2="3.8"  y2="14.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="11" y1="5.5"  x2="18.2" y2="14.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span className="bt-icon-label">NODES</span>
          </button>
        </div>

        {/* Tree name — centre */}
        <div className="bt-toolbar-center">
          <span className="bt-toolbar-name" title={displayName}>{displayName}</span>
        </div>

        <div className="bt-toolbar-end">
          {selectedNodeCount > 0 && (
            <button
              className="bt-icon-btn bt-delete-btn"
              onClick={onDeleteSelected}
              title={`Delete ${selectedNodeCount} selected node${selectedNodeCount > 1 ? 's' : ''}`}
            >
              <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor">
                <path d="M1 4h14M6 4V2h4v2M2 4l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {isExecuting ? (
            <button className="bt-action-btn bt-stop-btn" onClick={onStop} title="Stop execution">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="0" y="0" width="12" height="12" rx="2"/>
              </svg>
              <span className="bt-btn-label">Stop</span>
            </button>
          ) : (
            <button className="bt-action-btn bt-execute-btn" onClick={onExecute} title="Execute tree">
              <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
                <path d="M1 1l10 6L1 13V1z"/>
              </svg>
              <span className="bt-btn-label">Run</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Slide-in menu panel ──────────────────────────────────── */}
      {menuOpen && (
        <div className="bt-menu-overlay" onClick={closeMenu}>
          <div className="bt-menu-panel" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="bt-menu-header">
              <span className="bt-menu-title">Behavior Tree</span>
              <button className="bt-menu-close-btn" onClick={closeMenu} title="Close menu" aria-label="Close menu">
                <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="8,2 2,8 8,14"/>
                </svg>
                <span>Close</span>
              </button>
            </div>

            {/* Name editor */}
            <div className="bt-menu-section">
              <label className="bt-menu-label">Name</label>
              <input
                className="bt-menu-name-input"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={handleNameCommit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleNameCommit();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Tree name…"
                spellCheck={false}
              />
            </div>

            {/* Action grid */}
            <div className="bt-menu-section">
              <label className="bt-menu-label">Actions</label>
              <div className="bt-menu-actions">
                <button className="bt-menu-action-btn" onClick={handleNew}>
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
                    <path d="M2 0h7l5 5v11H2V0z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8 0v5h5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                  New
                </button>
                <button className="bt-menu-action-btn bt-menu-save-btn" onClick={handleSave}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 0h9l4 4v11a1 1 0 01-1 1H2a1 1 0 01-1-1V1a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                    <rect x="4" y="0" width="6" height="5" rx="0" fill="currentColor" opacity=".5"/>
                    <rect x="3" y="9" width="10" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                  Save
                </button>
                <button className="bt-menu-action-btn" onClick={onExport}>
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
                    <path d="M7 1v9M3 7l4 5 4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                    <path d="M1 12v3h12v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                  </svg>
                  Export
                </button>
                <button className="bt-menu-action-btn" onClick={handleImport}>
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
                    <path d="M7 11V2M3 6l4-5 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                    <path d="M1 12v3h12v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                  </svg>
                  Import
                </button>
              </div>
            </div>

            {/* Saved trees */}
            <div className="bt-menu-section bt-menu-section-list">
              <label className="bt-menu-label">
                Saved Trees
                {savedTrees.length > 0 && (
                  <span className="bt-menu-count">{savedTrees.length}</span>
                )}
              </label>
              <div className="bt-menu-tree-list">
                {savedTrees.length === 0 ? (
                  <div className="bt-menu-empty">No saved trees yet</div>
                ) : (
                  savedTrees.map(({ tree }) => (
                    <div
                      key={tree.id}
                      className={`bt-menu-tree-row${tree.id === currentTree?.id ? ' active' : ''}`}
                      onClick={() => handleLoad(tree.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleLoad(tree.id)}
                    >
                      <div className="bt-menu-tree-info">
                        <span className="bt-menu-tree-name">{tree.name}</span>
                        <span className="bt-menu-tree-date">
                          {new Date(tree.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        className="bt-menu-tree-delete"
                        onClick={(e) => handleDelete(tree.id, e)}
                        title="Delete"
                        aria-label="Delete tree"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default BehaviorTreeToolbar;
