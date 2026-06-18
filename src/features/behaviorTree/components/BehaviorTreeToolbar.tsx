import React, { useState, useRef, useEffect } from 'react';
import { BehaviorNodeType, BehaviorTree } from '../types';
import {
  BEHAVIOR_TREE_STORAGE_EVENT,
  listBehaviorTrees,
  loadBehaviorTree,
  deleteBehaviorTree,
  importBehaviorTree,
} from '../storage/treeStorage';
import './BehaviorTreeToolbar.css';

export type BehaviorTreeInteractionMode = 'pan' | 'select';

interface BehaviorTreeToolbarProps {
  currentTree: BehaviorTree | null;
  isExecuting: boolean;
  isPaletteCollapsed: boolean;
  isEditingSubtree: boolean;
  nodeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  interactionMode: BehaviorTreeInteractionMode;
  onSave: () => void;
  onLoad: (tree: BehaviorTree) => void;
  onNew: () => void;
  onExecute: () => void;
  onStop: () => void;
  onExport: () => void;
  onArrange: () => void;
  onTogglePalette: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onInteractionModeChange: (mode: BehaviorTreeInteractionMode) => void;
  onNavigateUp: () => void;
  onRename: (name: string) => void;
}

const BehaviorTreeToolbar: React.FC<BehaviorTreeToolbarProps> = ({
  currentTree,
  isExecuting,
  isPaletteCollapsed,
  isEditingSubtree,
  nodeCount,
  canUndo,
  canRedo,
  interactionMode,
  onSave,
  onLoad,
  onNew,
  onExecute,
  onStop,
  onExport,
  onArrange,
  onTogglePalette,
  onUndo,
  onRedo,
  onInteractionModeChange,
  onNavigateUp,
  onRename,
}) => {
  const [menuOpen, setMenuOpen]       = useState(false);
  const [savedTrees, setSavedTrees]   = useState(listBehaviorTrees());
  const [nameValue, setNameValue]     = useState(currentTree?.name ?? '');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // Sync local name whenever the active tree changes
  useEffect(() => {
    setNameValue(currentTree?.name ?? '');
  }, [currentTree?.id, currentTree?.name]);

  useEffect(() => {
    const handleSavedTreesChanged = () => setSavedTrees(listBehaviorTrees());
    window.addEventListener(BEHAVIOR_TREE_STORAGE_EVENT, handleSavedTreesChanged);
    return () => window.removeEventListener(BEHAVIOR_TREE_STORAGE_EVENT, handleSavedTreesChanged);
  }, []);

  const openMenu = () => {
    setSavedTrees(listBehaviorTrees());
    setMenuOpen(true);
  };

  const closeMenu = () => {
    setPendingDelete(null);
    setMenuOpen(false);
  };

  const handleSave = () => {
    onSave();
    setSavedTrees(listBehaviorTrees());
  };

  const handleLoad = (treeId: string) => {
    const tree = loadBehaviorTree(treeId);
    if (tree) { onLoad(tree); closeMenu(); }
  };

  const handleTreeDragStart = (event: React.DragEvent, tree: BehaviorTree) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({
        nodeType: BehaviorNodeType.Subtree,
        item: tree,
      })
    );
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDelete = (tree: BehaviorTree, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDelete({ id: tree.id, name: tree.name });
  };

  const cancelDelete = () => setPendingDelete(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteBehaviorTree(pendingDelete.id);
    setSavedTrees(listBehaviorTrees());
    setPendingDelete(null);
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

  useEffect(() => {
    if (!pendingDelete) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDelete(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingDelete]);

  const displayName = currentTree?.name ?? 'Untitled';

  return (
    <>
      {/* ── Floating top-left: menu pill ──────────────────────── */}
      <div className="bt-float-bar">
        {isEditingSubtree && (
          <button
            className="bt-float-icon-btn bt-parent-tree-btn"
            onClick={onNavigateUp}
            title="Back to parent tree"
            aria-label="Back to parent tree"
          >
            <svg width="21" height="21" viewBox="0 0 21 21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="2.75" width="7.5" height="5.5" rx="1.4" />
              <rect x="10.5" y="12.75" width="7.5" height="5.5" rx="1.4" />
              <path d="M14.25 12.75V10H6.75V8.25" />
              <path d="M6.75 8.25L4.2 10.8M6.75 8.25l2.55 2.55" />
            </svg>
            <span>Parent</span>
          </button>
        )}
        <button
          className="bt-float-menu-btn"
          onClick={openMenu}
          title="Menu: save, load, rename"
          aria-label="Open menu"
          data-testid="bt-menu-button"
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
          data-testid="bt-palette-toggle"
        >
          <span className="bt-palette-plus" aria-hidden="true">+</span>
        </button>

        <button
          className="bt-float-icon-btn bt-arrange-tree-btn"
          onClick={onArrange}
          disabled={nodeCount === 0}
          title="Arrange tree"
          aria-label="Arrange tree"
          data-testid="bt-arrange-tree"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="7.5" y="1.5" width="7" height="5" rx="1.5" />
            <rect x="1.5" y="15.5" width="7" height="5" rx="1.5" />
            <rect x="13.5" y="15.5" width="7" height="5" rx="1.5" />
            <path d="M11 6.5v4M5 15.5v-2.5h12v2.5" />
          </svg>
        </button>
        <button
          className={`bt-float-icon-btn bt-interaction-mode-btn${interactionMode === 'select' ? ' active' : ''}`}
          onClick={() => onInteractionModeChange('select')}
          title="Select nodes by dragging"
          aria-label="Select nodes by dragging"
          aria-pressed={interactionMode === 'select'}
          data-testid="bt-select-mode"
        >
          <svg width="23" height="23" viewBox="0 0 23 23" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.2" y="3.2" width="13.6" height="11.8" rx="2" strokeDasharray="3 2" />
            <path d="M12.5 12.5l5.7 5.7" />
            <path d="M15.6 18.1l2.6-2.6" />
          </svg>
        </button>
        <button
          className={`bt-float-icon-btn bt-interaction-mode-btn${interactionMode === 'pan' ? ' active' : ''}`}
          onClick={() => onInteractionModeChange('pan')}
          title="Pan canvas"
          aria-label="Pan canvas"
          aria-pressed={interactionMode === 'pan'}
          data-testid="bt-pan-mode"
        >
          <svg width="23" height="23" viewBox="0 0 23 23" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 11.2V6.4a1.45 1.45 0 0 1 2.9 0v4.3" />
            <path d="M10.9 10.6V5.1a1.45 1.45 0 0 1 2.9 0v5.5" />
            <path d="M13.8 11V6.6a1.45 1.45 0 0 1 2.9 0v6" />
            <path d="M8 11.2l-1-1a1.55 1.55 0 0 0-2.2 2.2l4.9 4.9a6 6 0 0 0 4.2 1.7h.8a4.9 4.9 0 0 0 4.9-4.9v-2.4a1.45 1.45 0 0 0-2.9 0" />
          </svg>
        </button>
        <button
          className="bt-float-icon-btn bt-undo-tree-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo last behavior tree change"
          aria-label="Undo last behavior tree change"
          data-testid="bt-undo"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7.5 6H3.5V2" />
            <path d="M3.8 6A7 7 0 1 1 5 15" />
          </svg>
        </button>
        <button
          className="bt-float-icon-btn bt-redo-tree-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo last behavior tree change"
          aria-label="Redo last behavior tree change"
          data-testid="bt-redo"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12.5 6h4V2" />
            <path d="M16.2 6A7 7 0 1 0 15 15" />
          </svg>
        </button>
      </div>

      {/* ── Floating top-right: delete + run/stop ─────────────── */}
      <div className="bt-float-actions">
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
          <div className="bt-menu-panel" onClick={(e) => e.stopPropagation()} data-testid="bt-menu-panel">

            {/* Name editor + close */}
            <div className="bt-menu-section">
              <div className="bt-menu-section-top">
                <label className="bt-menu-label">Name</label>
                <button className="bt-popover-close" onClick={closeMenu} aria-label="Close menu">
                  ×
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
                      draggable
                      onDragStart={(event) => handleTreeDragStart(event, tree)}
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
                        onClick={(e) => handleDelete(tree, e)}
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

      {pendingDelete && (
        <div className="bt-delete-confirm-overlay" onClick={cancelDelete}>
          <div
            className="bt-delete-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bt-delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bt-delete-confirm-icon" aria-hidden="true">
              <svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1,4 15,4"/>
                <path d="M6 4V2.4A1.2 1.2 0 0 1 7.2 1.2h1.6A1.2 1.2 0 0 1 10 2.4V4"/>
                <path d="M3.2 4l0.8 11.2A1.2 1.2 0 0 0 5.2 16.3h5.6a1.2 1.2 0 0 0 1.2-1.1L12.8 4"/>
              </svg>
            </div>
            <div className="bt-delete-confirm-copy">
              <h3 id="bt-delete-confirm-title">Delete behavior tree?</h3>
              <p>
                "{pendingDelete.name}" will be removed from saved trees.
              </p>
            </div>
            <div className="bt-delete-confirm-actions">
              <button className="bt-delete-confirm-cancel" onClick={cancelDelete}>
                Cancel
              </button>
              <button className="bt-delete-confirm-delete" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BehaviorTreeToolbar;
