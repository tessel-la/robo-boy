import React, { useState, useRef, useEffect } from 'react';
import TreePanelMenu from '../../treePanel/components/TreePanelMenu';
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
  isPaused: boolean;
  isEditingLocked: boolean;
  isPaletteCollapsed: boolean;
  nodeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  interactionMode: BehaviorTreeInteractionMode;
  isFollowMode: boolean;
  onSave: () => void;
  onLoad: (tree: BehaviorTree) => void;
  onNew: () => void;
  onExecute: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onExport: () => void;
  onArrange: () => void;
  onTogglePalette: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onInteractionModeChange: (mode: BehaviorTreeInteractionMode) => void;
  onToggleFollowMode: () => void;
  onOpenAgent: () => void;
  onRename: (name: string) => void;
  blackboardValues: Record<string, unknown>;
  onBlackboardDefaultsChange: (values: Record<string, unknown>) => void;
}

const BehaviorTreeToolbar: React.FC<BehaviorTreeToolbarProps> = ({
  currentTree,
  isExecuting,
  isPaused,
  isEditingLocked,
  isPaletteCollapsed,
  nodeCount,
  canUndo,
  canRedo,
  interactionMode,
  isFollowMode,
  onSave,
  onLoad,
  onNew,
  onExecute,
  onPause,
  onResume,
  onStop,
  onExport,
  onArrange,
  onTogglePalette,
  onUndo,
  onRedo,
  onInteractionModeChange,
  onToggleFollowMode,
  onOpenAgent,
  onRename,
  blackboardValues,
  onBlackboardDefaultsChange,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedTrees, setSavedTrees] = useState(listBehaviorTrees());
  const [nameValue, setNameValue] = useState(currentTree?.name ?? '');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [blackboardText, setBlackboardText] = useState(() => JSON.stringify(blackboardValues, null, 2));
  const [blackboardError, setBlackboardError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local name whenever the active tree changes
  useEffect(() => {
    setNameValue(currentTree?.name ?? '');
  }, [currentTree?.id, currentTree?.name]);

  useEffect(() => {
    setBlackboardText(JSON.stringify(blackboardValues, null, 2));
  }, [blackboardValues]);

  useEffect(() => {
    if (!isEditingLocked) return;
    setPendingDelete(null);
    setMenuOpen(false);
  }, [isEditingLocked]);

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
    if (tree) {
      onLoad(tree);
      closeMenu();
    }
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

  const handleNew = () => {
    onNew();
    closeMenu();
  };

  const handleImport = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const tree = await importBehaviorTree(file);
      if (tree) {
        onLoad(tree);
        closeMenu();
      }
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
  const menuContent = (
    <>
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
          onChange={event => setNameValue(event.target.value)}
          onBlur={handleNameCommit}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              handleNameCommit();
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Tree name…"
          spellCheck={false}
        />
      </div>

      <div className="bt-menu-section">
        <label className="bt-menu-label">Actions</label>
        <div className="bt-menu-actions">
          <button className="bt-menu-action-btn" onClick={handleNew}>
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
              <path d="M2 0h7l5 5v11H2V0z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 0v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            New
          </button>
          <button className="bt-menu-action-btn bt-menu-save-btn" onClick={handleSave}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M2 0h9l4 4v11a1 1 0 01-1 1H2a1 1 0 01-1-1V1a1 1 0 011-1z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect x="4" y="0" width="6" height="5" rx="0" fill="currentColor" opacity=".5" />
              <rect x="3" y="9" width="10" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Save
          </button>
          <button className="bt-menu-action-btn" onClick={onExport}>
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
              <path d="M7 1v9M3 7l4 5 4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              <path d="M1 12v3h12v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
            Export
          </button>
          <button className="bt-menu-action-btn" onClick={handleImport}>
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
              <path d="M7 11V2M3 6l4-5 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              <path d="M1 12v3h12v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
            Import
          </button>
        </div>
      </div>

      <div className="bt-menu-tree-section">
        <label className="bt-menu-label">
          Saved Trees
          {savedTrees.length > 0 && <span className="bt-menu-count">{savedTrees.length}</span>}
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
                onDragStart={event => handleTreeDragStart(event, tree)}
                onClick={() => handleLoad(tree.id)}
                role="button"
                tabIndex={0}
                onKeyDown={event => event.key === 'Enter' && handleLoad(tree.id)}
              >
                <div className="bt-menu-tree-info">
                  <span className="bt-menu-tree-name">{tree.name}</span>
                  <span className="bt-menu-tree-date">{new Date(tree.updatedAt).toLocaleDateString()}</span>
                </div>
                <button
                  className="bt-menu-tree-delete"
                  onClick={event => handleDelete(tree, event)}
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

      <div className="bt-menu-section">
        <label className="bt-menu-label">Blackboard {isExecuting ? '(live)' : '(defaults)'}</label>
        <textarea
          className="bt-blackboard-editor"
          value={blackboardText}
          readOnly={isExecuting}
          spellCheck={false}
          onChange={event => setBlackboardText(event.target.value)}
          onBlur={() => {
            if (isExecuting) return;
            try {
              const parsed = JSON.parse(blackboardText);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
              setBlackboardError('');
              onBlackboardDefaultsChange(parsed);
            } catch {
              setBlackboardError('Enter a JSON object.');
            }
          }}
        />
        {blackboardError && <div className="bt-blackboard-error">{blackboardError}</div>}
      </div>

      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
    </>
  );

  return (
    <>
      <TreePanelMenu
        open={menuOpen}
        onOpen={openMenu}
        onClose={closeMenu}
        triggerBarClassName="bt-float-bar"
        triggerContent={
          <span className="bt-float-name" title={displayName}>
            {displayName}
          </span>
        }
        triggerAfter={
          <>
            <button
              className={`bt-float-icon-btn bt-palette-toggle${isPaletteCollapsed ? '' : ' active'}`}
              onClick={onTogglePalette}
              disabled={isEditingLocked}
              title={isPaletteCollapsed ? 'Show node palette' : 'Hide node palette'}
              aria-label="Toggle node palette"
              data-testid="bt-palette-toggle"
            >
              <span className="bt-palette-plus" aria-hidden="true">
                +
              </span>
            </button>

            <button
              className="bt-float-icon-btn bt-arrange-tree-btn"
              onClick={onArrange}
              disabled={isEditingLocked || nodeCount === 0}
              title="Arrange tree"
              aria-label="Arrange tree"
              data-testid="bt-arrange-tree"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 22 22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="7.5" y="1.5" width="7" height="5" rx="1.5" />
                <rect x="1.5" y="15.5" width="7" height="5" rx="1.5" />
                <rect x="13.5" y="15.5" width="7" height="5" rx="1.5" />
                <path d="M11 6.5v4M5 15.5v-2.5h12v2.5" />
              </svg>
            </button>
            <button
              className="bt-float-icon-btn bt-agent-tree-btn"
              onClick={onOpenAgent}
              disabled={isEditingLocked}
              title="Create tree with AI"
              aria-label="Create tree with AI"
              data-testid="bt-open-agent"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3z" />
                <path d="M18.5 13l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2zM5.5 14l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7z" />
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
              <svg className="bt-select-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="3.5"
                  y="3.5"
                  width="11.5"
                  height="11.5"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeDasharray="3.4 2.6"
                />
                <path d="M12.7 12.7l7.1 7.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M16.6 20.2l3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
              <svg className="bt-pan-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M8.4 12.2V7.1a1.55 1.55 0 0 1 3.1 0v4.7"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M11.5 11.6V5.7a1.55 1.55 0 0 1 3.1 0v6"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14.6 12.1V7.5a1.55 1.55 0 0 1 3.1 0v7"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.4 12.2l-1.2-1.2a1.8 1.8 0 0 0-2.55 2.55l4.75 4.75A6.2 6.2 0 0 0 13.8 20h.85a5.05 5.05 0 0 0 5.05-5.05v-2.2a1.5 1.5 0 0 0-3 0"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className="bt-float-icon-btn bt-undo-tree-btn"
              onClick={onUndo}
              disabled={isEditingLocked || !canUndo}
              title="Undo last behavior tree change"
              aria-label="Undo last behavior tree change"
              data-testid="bt-undo"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7.5 6H3.5V2" />
                <path d="M3.8 6A7 7 0 1 1 5 15" />
              </svg>
            </button>
            <button
              className="bt-float-icon-btn bt-redo-tree-btn"
              onClick={onRedo}
              disabled={isEditingLocked || !canRedo}
              title="Redo last behavior tree change"
              aria-label="Redo last behavior tree change"
              data-testid="bt-redo"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12.5 6h4V2" />
                <path d="M16.2 6A7 7 0 1 0 15 15" />
              </svg>
            </button>
          </>
        }
        buttonLabel="Open menu"
        buttonTitle="Menu: save, load, rename"
        disabled={isEditingLocked}
        buttonTestId="bt-menu-button"
        panelTestId="bt-menu-panel"
        panelLabel="Behavior tree menu"
        menuContent={menuContent}
        classNames={{
          button: 'bt-float-menu-btn',
          overlay: 'bt-menu-overlay',
          panel: 'bt-menu-panel',
          resizeHandle: 'bt-menu-resize-handle',
        }}
      />

      {/* ── Floating top-right: delete + run/stop ─────────────── */}
      <div className="bt-float-actions">
        <button
          className={`bt-float-icon-btn bt-follow-mode-btn${isFollowMode ? ' active' : ''}`}
          onClick={onToggleFollowMode}
          title={isFollowMode ? 'Disable follow mode' : 'Enable follow mode'}
          aria-label={isFollowMode ? 'Disable follow mode' : 'Enable follow mode'}
          aria-pressed={isFollowMode}
          data-testid="bt-follow-mode"
        >
          <svg className="bt-follow-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
            <path
              d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className={isExecuting && !isPaused ? 'bt-float-pause-btn' : 'bt-float-run-btn'}
          onClick={isExecuting ? (isPaused ? onResume : onPause) : onExecute}
          title={isExecuting ? (isPaused ? 'Resume execution' : 'Pause execution') : 'Execute tree'}
          aria-label={isExecuting ? (isPaused ? 'Resume' : 'Pause') : 'Run'}
          data-testid="bt-run-pause"
        >
          {isExecuting && !isPaused ? (
            <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
              <rect x="1" y="1" width="3" height="11" rx="1" />
              <rect x="7" y="1" width="3" height="11" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
              <path d="M1 1l9 5.5L1 12V1z" />
            </svg>
          )}
          <span className="bt-float-btn-label">{isExecuting ? (isPaused ? 'Resume' : 'Pause') : 'Run'}</span>
        </button>
        <button
          className="bt-float-stop-btn"
          onClick={onStop}
          disabled={!isExecuting}
          title="Stop execution"
          aria-label="Stop"
          data-testid="bt-stop"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true">
            <rect x="0" y="0" width="11" height="11" rx="2" />
          </svg>
          <span className="bt-float-btn-label">Stop</span>
        </button>
      </div>

      {pendingDelete && (
        <div className="bt-delete-confirm-overlay" onClick={cancelDelete}>
          <div
            className="bt-delete-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bt-delete-confirm-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="bt-delete-confirm-icon" aria-hidden="true">
              <svg
                width="16"
                height="18"
                viewBox="0 0 16 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="1,4 15,4" />
                <path d="M6 4V2.4A1.2 1.2 0 0 1 7.2 1.2h1.6A1.2 1.2 0 0 1 10 2.4V4" />
                <path d="M3.2 4l0.8 11.2A1.2 1.2 0 0 0 5.2 16.3h5.6a1.2 1.2 0 0 0 1.2-1.1L12.8 4" />
              </svg>
            </div>
            <div className="bt-delete-confirm-copy">
              <h3 id="bt-delete-confirm-title">Delete behavior tree?</h3>
              <p>"{pendingDelete.name}" will be removed from saved trees.</p>
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
