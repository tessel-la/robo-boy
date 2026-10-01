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
import TreeRepositoryBrowser from '../repository/TreeRepositoryBrowser';

interface Props {
  currentTree: BehaviorTree | null;
  isEditingLocked: boolean;
  nodeCount: number;
  onSave: () => void;
  onLoad: (tree: BehaviorTree) => void;
  onNew: () => void;
  onNewXml?: () => void;
  onExport: () => void;
  onRename: (name: string) => void;
  children?: React.ReactNode;
  triggerAfter?: React.ReactNode;
  allowDuringExecution?: boolean;
}
export default function BehaviorTreeDocumentMenu({
  currentTree,
  isEditingLocked,
  nodeCount,
  onSave,
  onLoad,
  onNew,
  onNewXml,
  onExport,
  onRename,
  children,
  triggerAfter,
  allowDuringExecution = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [savedTrees, setSavedTrees] = useState(listBehaviorTrees());
  const [nameValue, setNameValue] = useState(currentTree?.name ?? '');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [pendingNew, setPendingNew] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newKind = useRef<'graph' | 'xml'>('graph');

  // Sync local name whenever the active tree changes
  useEffect(() => {
    setNameValue(currentTree?.name ?? '');
  }, [currentTree?.id, currentTree?.name]);

  useEffect(() => {
    if (!isEditingLocked) return;
    setPendingDelete(null);
    setPendingNew(false);
    if (!allowDuringExecution) setMenuOpen(false);
  }, [isEditingLocked, allowDuringExecution]);

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
    setPendingNew(false);
    setMenuOpen(false);
  };

  const handleSave = () => {
    onSave();
    setSavedTrees(listBehaviorTrees());
  };

  const handleLoad = (treeId: string) => {
    if (isEditingLocked) return;
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
    setPendingNew(false);
    setPendingDelete({ id: tree.id, name: tree.name });
  };

  const cancelDelete = () => setPendingDelete(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteBehaviorTree(pendingDelete.id);
    setSavedTrees(listBehaviorTrees());
    setPendingDelete(null);
  };

  const handleNew = (kind: 'graph' | 'xml' = 'graph') => {
    newKind.current = kind;
    if (nodeCount > 0 || currentTree?.nativeDocument) {
      setPendingDelete(null);
      setPendingNew(true);
      return;
    }

    if (kind === 'xml') onNewXml?.();
    else onNew();
    closeMenu();
  };

  const cancelNew = () => setPendingNew(false);

  const confirmNew = () => {
    if (newKind.current === 'xml') onNewXml?.();
    else onNew();
    closeMenu();
  };

  const handleImport = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportError(null);
      const tree = await importBehaviorTree(file);
      if (tree) {
        onLoad(tree);
        closeMenu();
      } else {
        setImportError('Could not import tree. Use valid JSON or self-contained BehaviorTree XML.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleNameCommit = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== currentTree?.name) onRename(trimmed);
  };

  useEffect(() => {
    if (!pendingDelete && !pendingNew) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingDelete(null);
        setPendingNew(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingDelete, pendingNew]);

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
          disabled={isEditingLocked}
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
        <fieldset className="bt-menu-actions" disabled={isEditingLocked}>
          <button className="bt-menu-action-btn" onClick={() => handleNew()}>
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
          <button className="bt-menu-action-btn" onClick={() => handleNew('xml')}>
            New XML tree
          </button>
          <button className="bt-menu-action-btn" onClick={handleImport}>
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
              <path d="M7 11V2M3 6l4-5 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              <path d="M1 12v3h12v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
            Import
          </button>
        </fieldset>
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
                draggable={!tree.nativeDocument && !isEditingLocked}
                onDragStart={event => handleTreeDragStart(event, tree)}
                onClick={() => handleLoad(tree.id)}
                role="button"
                tabIndex={0}
                aria-disabled={isEditingLocked}
                onKeyDown={event => event.key === 'Enter' && handleLoad(tree.id)}
              >
                <div className="bt-menu-tree-info">
                  <span className="bt-menu-tree-name">{tree.name}</span>
                  <span className="bt-menu-tree-date">
                    {tree.nativeDocument ? (tree.nativeDocument.runtime || 'XML') + ' · ' : 'JSON · '}
                    {new Date(tree.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  className="bt-menu-tree-delete"
                  disabled={isEditingLocked}
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

      {children}
      <TreeRepositoryBrowser
        disabled={isEditingLocked}
        onLoad={tree => {
          onLoad(tree);
          closeMenu();
        }}
      />

      {importError && (
        <div className="bt-save-toast error" role="alert">
          {importError}
          <button onClick={() => setImportError(null)} aria-label="Dismiss import error">
            ×
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.xml"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
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
        triggerAfter={triggerAfter}
        buttonLabel="Open menu"
        buttonTitle="Tree menu"
        buttonTestId="bt-menu-button"
        disabled={isEditingLocked && !allowDuringExecution}
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
      {pendingDelete && (
        <div className="bt-confirm-overlay" onClick={cancelDelete}>
          <div
            className="bt-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bt-delete-confirm-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="bt-confirm-icon danger" aria-hidden="true">
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
            <div className="bt-confirm-copy">
              <h3 id="bt-delete-confirm-title">Delete behavior tree?</h3>
              <p>"{pendingDelete.name}" will be removed from saved trees.</p>
            </div>
            <div className="bt-confirm-actions">
              <button className="bt-confirm-cancel" onClick={cancelDelete}>
                Cancel
              </button>
              <button className="bt-confirm-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingNew && (
        <div className="bt-confirm-overlay" onClick={cancelNew}>
          <div
            className="bt-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bt-new-confirm-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="bt-confirm-icon primary" aria-hidden="true">
              <svg width="17" height="19" viewBox="0 0 14 16" fill="none">
                <path d="M2 0h7l5 5v11H2V0z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 0v5h5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="bt-confirm-copy">
              <h3 id="bt-new-confirm-title">Create new tree?</h3>
              <p>The current tree will be replaced. Save it first to keep your changes.</p>
            </div>
            <div className="bt-confirm-actions">
              <button className="bt-confirm-cancel" onClick={cancelNew}>
                Cancel
              </button>
              <button className="bt-confirm-primary" onClick={confirmNew} autoFocus>
                Create new tree
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
