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

interface BehaviorTreeToolbarProps {
  currentTree: BehaviorTree | null;
  isExecuting: boolean;
  isPaletteCollapsed: boolean;
  isEditingSubtree: boolean;
  nodeCount: number;
  selectedNodeCount: number;
  canWrapSelection: boolean;
  hasSelectedSubtree: boolean;
  onSave: () => void;
  onLoad: (tree: BehaviorTree) => void;
  onNew: () => void;
  onExecute: () => void;
  onStop: () => void;
  onExport: () => void;
  onArrange: () => void;
  onTogglePalette: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onRenameSelected: () => void;
  onWrapSelection: () => void;
  onOpenSelectedSubtree: () => void;
  onSaveSelectedSubtree: () => void;
  onExplodeSelectedSubtree: () => void;
  onNavigateUp: () => void;
  onRename: (name: string) => void;
}

const BehaviorTreeToolbar: React.FC<BehaviorTreeToolbarProps> = ({
  currentTree,
  isExecuting,
  isPaletteCollapsed,
  isEditingSubtree,
  nodeCount,
  selectedNodeCount,
  canWrapSelection,
  hasSelectedSubtree,
  onSave,
  onLoad,
  onNew,
  onExecute,
  onStop,
  onExport,
  onArrange,
  onTogglePalette,
  onDeleteSelected,
  onDuplicateSelected,
  onRenameSelected,
  onWrapSelection,
  onOpenSelectedSubtree,
  onSaveSelectedSubtree,
  onExplodeSelectedSubtree,
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
            className="bt-float-icon-btn"
            onClick={onNavigateUp}
            title="Back to parent tree"
            aria-label="Back to parent tree"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.5 4.5L6 9l4.5 4.5" />
              <path d="M6.5 9H14" />
            </svg>
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
          <svg width="28" height="26" viewBox="0 0 28 26" fill="currentColor" aria-hidden="true">
            <circle cx="14" cy="4" r="3.5"/>
            <circle cx="5" cy="21" r="3.5"/>
            <circle cx="23" cy="21" r="3.5"/>
            <line x1="12.4" y1="7.2" x2="6.8" y2="17.7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/>
            <line x1="15.6" y1="7.2" x2="21.2" y2="17.7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/>
          </svg>
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
      </div>

      {/* ── Floating top-right: delete + run/stop ─────────────── */}
      <div className="bt-float-actions">
        {selectedNodeCount > 0 && (
          <>
            {selectedNodeCount === 1 && (
              <button
                className="bt-float-rename-btn"
                onClick={onRenameSelected}
                title="Rename selected node"
                aria-label="Rename selected node"
                data-testid="bt-rename-selected"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.8 1.5l2.7 2.7-8.2 8.2-3.6.9.9-3.6 8.2-8.2z"/>
                  <path d="M9.2 3.1l2.7 2.7"/>
                </svg>
                <span className="bt-float-btn-label">Rename</span>
              </button>
            )}
            {canWrapSelection && (
              <button
                className="bt-float-duplicate-btn"
                onClick={onWrapSelection}
                title="Wrap selected sequence items in a subtree"
                aria-label="Wrap selected nodes in a subtree"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="1.5" y="3.5" width="4" height="4" rx="0.8" />
                  <rect x="10.5" y="3.5" width="4" height="4" rx="0.8" />
                  <rect x="6" y="9.5" width="4" height="4" rx="0.8" />
                  <path d="M5.5 5.5h5M8 5.5v4" />
                </svg>
                <span className="bt-float-btn-label">Wrap</span>
              </button>
            )}
            {hasSelectedSubtree && (
              <>
                <button
                  className="bt-float-rename-btn"
                  onClick={onOpenSelectedSubtree}
                  title="Open selected subtree"
                  aria-label="Open selected subtree"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="2" width="12" height="12" rx="2" />
                    <path d="M6 5h5v5M11 5L5 11" />
                  </svg>
                  <span className="bt-float-btn-label">Open</span>
                </button>
                <button
                  className="bt-float-rename-btn"
                  onClick={onExplodeSelectedSubtree}
                  title="Explode selected subtree back into this tree"
                  aria-label="Explode selected subtree"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                    <path d="M8 5v6M5 8h6" />
                    <path d="M5 5l-2-2M11 5l2-2M5 11l-2 2M11 11l2 2" />
                  </svg>
                  <span className="bt-float-btn-label">Explode</span>
                </button>
                <button
                  className="bt-float-duplicate-btn"
                  onClick={onSaveSelectedSubtree}
                  title="Save selected subtree as a saved tree"
                  aria-label="Save selected subtree"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M2 0h9l4 4v11a1 1 0 01-1 1H2a1 1 0 01-1-1V1a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                    <rect x="4" y="0" width="6" height="5" rx="0" fill="currentColor" opacity=".5"/>
                    <rect x="3" y="9" width="10" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                  <span className="bt-float-btn-label">Save Subtree</span>
                </button>
              </>
            )}
            <button
              className="bt-float-duplicate-btn"
              onClick={onDuplicateSelected}
              title={`Duplicate ${selectedNodeCount} selected node${selectedNodeCount > 1 ? 's' : ''}`}
              aria-label="Duplicate selected nodes"
              data-testid="bt-duplicate-selected"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="5" width="8" height="8" rx="1.2"/>
                <path d="M2 10V3.2A1.2 1.2 0 0 1 3.2 2H10"/>
              </svg>
              <span className="bt-float-btn-label">Duplicate</span>
            </button>
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
          </>
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
