import React, { useState, useRef } from 'react';
import { useReactFlow } from 'reactflow';
import { BehaviorTree } from '../types';
import {
  listBehaviorTrees,
  saveBehaviorTree,
  loadBehaviorTree,
  deleteBehaviorTree,
  exportBehaviorTree,
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
}) => {
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [savedTrees, setSavedTrees] = useState(listBehaviorTrees());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  const handleSave = () => {
    onSave();
    setSavedTrees(listBehaviorTrees());
  };

  const handleLoad = (treeId: string) => {
    const tree = loadBehaviorTree(treeId);
    if (tree) {
      onLoad(tree);
      setShowLoadMenu(false);
    }
  };

  const handleDelete = (treeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this behavior tree?')) {
      deleteBehaviorTree(treeId);
      setSavedTrees(listBehaviorTrees());
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const tree = await importBehaviorTree(file);
      if (tree) onLoad(tree);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFitView = () => {
    fitView({ padding: 0.2, duration: 300 });
  };

  return (
    <div className="bt-toolbar">
      <div className="bt-toolbar-section">
        {/* Mobile-only: palette toggle */}
        <button
          className={`bt-toolbar-btn bt-toolbar-palette-toggle${isPaletteCollapsed ? '' : ' active'}`}
          onClick={onTogglePalette}
          title={isPaletteCollapsed ? 'Open Node Palette' : 'Close Node Palette'}
        >
          <span className="bt-toolbar-icon">{isPaletteCollapsed ? '☰' : '✕'}</span>
        </button>

        <button className="bt-toolbar-btn" onClick={onNew} title="New Tree">
          <span className="bt-toolbar-icon">📄</span>
          <span className="bt-toolbar-label">New</span>
        </button>

        <button className="bt-toolbar-btn" onClick={handleSave} title="Save Tree">
          <span className="bt-toolbar-icon">💾</span>
          <span className="bt-toolbar-label">Save</span>
        </button>

        <div className="bt-toolbar-dropdown">
          <button
            className="bt-toolbar-btn"
            onClick={() => setShowLoadMenu(!showLoadMenu)}
            title="Load Tree"
          >
            <span className="bt-toolbar-icon">📂</span>
            <span className="bt-toolbar-label">Load</span>
            <span className="bt-toolbar-caret">▼</span>
          </button>

          {showLoadMenu && (
            <div className="bt-toolbar-menu">
              {savedTrees.length === 0 ? (
                <div className="bt-toolbar-menu-item disabled">No saved trees</div>
              ) : (
                savedTrees.map((saved) => (
                  <div
                    key={saved.tree.id}
                    className="bt-toolbar-menu-item"
                    onClick={() => handleLoad(saved.tree.id)}
                  >
                    <span className="bt-tree-name">{saved.tree.name}</span>
                    <span className="bt-tree-date">
                      {new Date(saved.tree.updatedAt).toLocaleDateString()}
                    </span>
                    <button
                      className="bt-tree-delete"
                      onClick={(e) => handleDelete(saved.tree.id, e)}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button className="bt-toolbar-btn" onClick={onExport} title="Export Tree">
          <span className="bt-toolbar-icon">📤</span>
          <span className="bt-toolbar-label">Export</span>
        </button>

        <button className="bt-toolbar-btn" onClick={handleImport} title="Import Tree">
          <span className="bt-toolbar-icon">📥</span>
          <span className="bt-toolbar-label">Import</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      <div className="bt-toolbar-section bt-toolbar-center">
        {currentTree && (
          <span className="bt-tree-title">{currentTree.name}</span>
        )}
      </div>

      <div className="bt-toolbar-section">
        {/* Delete selected nodes — shown when selection is active */}
        {selectedNodeCount > 0 && (
          <button
            className="bt-toolbar-btn bt-toolbar-delete"
            onClick={onDeleteSelected}
            title={`Delete ${selectedNodeCount} selected node${selectedNodeCount > 1 ? 's' : ''}`}
          >
            <span className="bt-toolbar-icon">🗑</span>
            <span className="bt-toolbar-label">Delete ({selectedNodeCount})</span>
          </button>
        )}

        <button
          className="bt-toolbar-btn bt-toolbar-zoom"
          onClick={() => zoomOut()}
          title="Zoom Out"
        >
          <span className="bt-toolbar-icon">−</span>
        </button>

        <button
          className="bt-toolbar-btn bt-toolbar-zoom"
          onClick={handleFitView}
          title="Fit View"
        >
          <span className="bt-toolbar-icon">⊡</span>
        </button>

        <button
          className="bt-toolbar-btn bt-toolbar-zoom"
          onClick={() => zoomIn()}
          title="Zoom In"
        >
          <span className="bt-toolbar-icon">+</span>
        </button>

        {isExecuting ? (
          <button
            className="bt-toolbar-btn bt-toolbar-stop"
            onClick={onStop}
            title="Stop Execution"
          >
            <span className="bt-toolbar-icon">⏹</span>
            <span className="bt-toolbar-label">Stop</span>
          </button>
        ) : (
          <button
            className="bt-toolbar-btn bt-toolbar-execute"
            onClick={onExecute}
            title="Execute Tree"
          >
            <span className="bt-toolbar-icon">▶</span>
            <span className="bt-toolbar-label">Execute</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default BehaviorTreeToolbar;
