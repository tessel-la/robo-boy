import React from 'react';
import { MdSelectAll } from 'react-icons/md';
import BehaviorTreeDocumentMenu from './BehaviorTreeDocumentMenu';
import BlackboardEditor from './BlackboardEditor';
import { BehaviorTree, BlackboardValueType } from '../types';
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
  persistentExecution: boolean;
  onSave: () => void;
  onLoad: (tree: BehaviorTree) => void;
  onNew: () => void;
  onImportLibrary?: (tree: BehaviorTree, prefix?: string) => void;
  runtimeSettings?: React.ReactNode;
  engineControl?: React.ReactNode;
  nativeControls?: {
    ready: boolean;
    busy: boolean;
    canControl: boolean;
    canReset: boolean;
    onCancel: () => void;
    onReset: () => void;
    onSource: () => void;
  };
  runDisabled?: boolean;
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
  onPersistentExecutionChange: (enabled: boolean) => void;
  onOpenAgent: () => void;
  onRename: (name: string) => void;
  blackboardValues: Record<string, unknown>;
  blackboardTypes: Record<string, BlackboardValueType>;
  onBlackboardDefaultsChange: (values: Record<string, unknown>, types: Record<string, BlackboardValueType>) => void;
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
  persistentExecution,
  onSave,
  onLoad,
  onNew,
  onImportLibrary,
  runtimeSettings,
  engineControl,
  nativeControls,
  runDisabled = false,
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
  onPersistentExecutionChange,
  onOpenAgent,
  onRename,
  blackboardValues,
  blackboardTypes,
  onBlackboardDefaultsChange,
}) => {
  return (
    <>
      <BehaviorTreeDocumentMenu
        allowDuringExecution={!!nativeControls}
        currentTree={currentTree}
        isEditingLocked={isEditingLocked}
        nodeCount={nodeCount}
        onSave={onSave}
        onLoad={onLoad}
        onNew={onNew}
        onImportLibrary={onImportLibrary}
        onEditSource={nativeControls?.onSource}
        onExport={onExport}
        onRename={onRename}
        triggerAfter={
          <>
            {engineControl}
            <button
              className={`bt-float-icon-btn bt-palette-toggle${isPaletteCollapsed ? '' : ' active'}`}
              onClick={onTogglePalette}
              disabled={isEditingLocked && !nativeControls}
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
              disabled={isEditingLocked || !!nativeControls}
              title="Create tree with AI"
              aria-label="Create tree with AI"
              data-testid="bt-open-agent"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
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
              <MdSelectAll className="bt-select-tool-icon" aria-hidden="true" />
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
      >
        {runtimeSettings}
        {nativeControls ? (
          <div className="bt-menu-section bt-menu-actions">
            <button
              className="bt-menu-action-btn"
              disabled={nativeControls.busy || !isExecuting || !nativeControls.canControl}
              onClick={nativeControls.onCancel}
            >
              Cancel
            </button>
            <button
              className="bt-menu-action-btn"
              disabled={nativeControls.busy || !nativeControls.canReset}
              onClick={nativeControls.onReset}
            >
              Reset
            </button>
          </div>
        ) : (
          <div className="bt-menu-section">
            <label className="bt-menu-label">Blackboard {isExecuting ? '(live)' : '(defaults)'}</label>
            <BlackboardEditor
              values={blackboardValues}
              types={blackboardTypes}
              readOnly={isExecuting}
              onChange={onBlackboardDefaultsChange}
            />
          </div>
        )}
      </BehaviorTreeDocumentMenu>
      {/* ── Floating top-right: delete + run/stop ─────────────── */}
      <div className="bt-float-actions">
        <label
          className={`bt-persistent-toggle${persistentExecution ? ' active' : ''}`}
          title="Keep this tree running in ROS if Robo-Boy is closed"
        >
          <input
            type="checkbox"
            checked={persistentExecution}
            disabled={isExecuting || !!nativeControls}
            onChange={event => onPersistentExecutionChange(event.target.checked)}
          />
          <svg className="bt-persistent-toggle-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="3" width="16" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <rect x="4" y="14" width="16" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="8" cy="6.5" r="1" fill="currentColor" />
            <circle cx="8" cy="17.5" r="1" fill="currentColor" />
            <path d="M12 6.5h5M12 17.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="bt-persistent-toggle-track" aria-hidden="true">
            <span />
          </span>
          <span className="bt-persistent-toggle-label">Keep running</span>
        </label>
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
          className={isExecuting && !isPaused && !nativeControls ? 'bt-float-pause-btn' : 'bt-float-run-btn'}
          onClick={isExecuting ? (isPaused ? onResume : onPause) : onExecute}
          disabled={
            runDisabled || (nativeControls ? nativeControls.busy || !nativeControls.ready || isExecuting : false)
          }
          title={isExecuting && !nativeControls ? (isPaused ? 'Resume execution' : 'Pause execution') : 'Execute tree'}
          aria-label={isExecuting && !nativeControls ? (isPaused ? 'Resume' : 'Pause') : 'Run'}
          data-testid="bt-run-pause"
        >
          {isExecuting && !isPaused && !nativeControls ? (
            <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
              <rect x="1" y="1" width="3" height="11" rx="1" />
              <rect x="7" y="1" width="3" height="11" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
              <path d="M1 1l9 5.5L1 12V1z" />
            </svg>
          )}
          <span className="bt-float-btn-label">
            {isExecuting && !nativeControls ? (isPaused ? 'Resume' : 'Pause') : 'Run'}
          </span>
        </button>
        <button
          className="bt-float-stop-btn"
          onClick={onStop}
          disabled={!isExecuting || (nativeControls ? nativeControls.busy || !nativeControls.canControl : false)}
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
    </>
  );
};
export default BehaviorTreeToolbar;
