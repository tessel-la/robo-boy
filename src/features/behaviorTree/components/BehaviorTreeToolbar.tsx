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
      {/* ── Floating top-left: menu pill ──────────────────────── */}
      <div className="bt-float-bar">
        <button
          className="bt-float-menu-btn"
          onClick={openMenu}
          title="Menu: save, load, rename"
          aria-label="Open menu"
        >
          <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor" aria-hidden="true">
            <rect y="0"   width="14" height="1.8" rx="0.9"/>
            <rect y="4.6" width="14" height="1.8" rx="0.9"/>
            <rect y="9.2" width="14" height="1.8" rx="0.9"/>
          </svg>
          <span className="bt-float-name" title={displayName}>{displayName}</span>
        </button>

        {/* Palette toggle — mobile only */}
        <button
          className={`bt-float-icon-btn bt-palette-toggle${isPaletteCollapsed ? '' : ' active'}`}
          onClick={onTogglePalette}
          title={isPaletteCollapsed ? 'Show node palette' : 'Hide node palette'}
          aria-label="Toggle node palette"
        >
          <svg width="18" height="16" viewBox="0 0 18 16" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="2.5" r="2"/>
            <circle cx="2.5" cy="13.5" r="2"/>
            <circle cx="15.5" cy="13.5" r="2"/>
            <line x1="9" y1="4.5" x2="3.2" y2="11.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="9" y1="4.5" x2="14.8" y2="11.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* ── Floating top-right: delete + run/stop ─────────────── */}
      <div className="bt-float-actions">
        {selectedNodeCount > 0 && (
          <button
            className="bt-float-delete-btn"
            onClick={onDeleteSelected}
            title={`Delete ${selectedNodeCount} selected node${selectedNodeCount > 1 ? 's' : ''}`}
          >
            <svg width="13" height="15" viewBox="0 0 13 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="0.5,3.5 12.5,3.5"/>
              <path d="M4 3.5V2a0.8 0.8 0 0 1 0.8-0.8h3.4a0.8 0.8 0 0 1 0.8 0.8v1.5"/>
              <path d="M2 3.5l0.8 9a0.8 0.8 0 0 0 0.8 0.8h5.8a0.8 0.8 0 0 0 0.8-0.8l0.8-9"/>
            </svg>
            <span className="bt-float-count">{selectedNodeCount}</span>
          </button>
        )}

        {isExecuting ? (
          <button className="bt-float-stop-btn" onClick={onStop} title="Stop execution">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true">
              <rect x="0" y="0" width="11" height="11" rx="2"/>
            </svg>
            <span className="bt-float-btn-label">Stop</span>
          </button>
        ) : (
          <button className="bt-float-run-btn" onClick={onExecute} title="Execute tree">
            <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
              <path d="M1 1l9 5.5L1 12V1z"/>
            </svg>
            <span className="bt-float-btn-label">Run</span>
          </button>
        )}
      </div>

      {/* ── Slide-in menu panel ──────────────────────────────────── */}
      {menuOpen && (
        <div className="bt-menu-overlay" onClick={closeMenu}>
          <div className="bt-menu-panel" onClick={(e) => e.stopPropagation()}>

            {/* Name editor + close */}
            <div className="bt-menu-section">
              <div className="bt-menu-section-top">
                <label className="bt-menu-label">Name</label>
                <button className="bt-popover-close" onClick={closeMenu} aria-label="Close menu">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <line x1="2" y1="2" x2="10" y2="10"/>
                    <line x1="10" y1="2" x2="2" y2="10"/>
                  </svg>
                </button>
              </div>
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
            <div className="bt-menu-tree-section">
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
