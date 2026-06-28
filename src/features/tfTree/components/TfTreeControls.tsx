import React from 'react';
import { FaCalculator, FaExpand, FaPause, FaPlay } from 'react-icons/fa';

import TreePanelMenu from '../../treePanel/components/TreePanelMenu';
import TreePanelSearch, { TreePanelSearchResult } from '../../treePanel/components/TreePanelSearch';
import { TfMultipleParentWarning } from '../tfTreeModel';

export interface TfVisibleTree {
  id: string;
  rootFrame: string;
  frames: string[];
}

interface TfTreeControlsProps {
  menuOpen: boolean;
  onMenuOpen: () => void;
  onMenuClose: () => void;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onArrange: () => void;
  calculatorOpen: boolean;
  onToggleCalculator: () => void;
  onFocusTree: (tree: TfVisibleTree) => void;
  visibleTrees: TfVisibleTree[];
  frameCount: number;
  transformCount: number;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchResults: TreePanelSearchResult<string>[];
  onSelectFrame: (frame: string) => void;
  filterQuery: string;
  onFilterQueryChange: (query: string) => void;
  showStatic: boolean;
  onShowStaticChange: (show: boolean) => void;
  highlightStale: boolean;
  onHighlightStaleChange: (highlight: boolean) => void;
  cycles: string[][];
  multipleParents: TfMultipleParentWarning[];
}

const TfTreeControls: React.FC<TfTreeControlsProps> = ({
  menuOpen,
  onMenuOpen,
  onMenuClose,
  isPaused,
  onPause,
  onResume,
  onArrange,
  calculatorOpen,
  onToggleCalculator,
  onFocusTree,
  visibleTrees,
  frameCount,
  transformCount,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  onSelectFrame,
  filterQuery,
  onFilterQueryChange,
  showStatic,
  onShowStaticChange,
  highlightStale,
  onHighlightStaleChange,
  cycles,
  multipleParents,
}) => {
  const warningCount = cycles.length + multipleParents.length;
  const menuContent = (
    <>
      <div className="tf-tree-menu-section">
        <div className="tf-tree-menu-heading-row">
          <span className="tf-tree-menu-label">Overview</span>
          <button type="button" className="tf-tree-menu-close" onClick={onMenuClose} aria-label="Close TF tree menu">
            x
          </button>
        </div>
        <div className="tf-tree-metrics" aria-label="TF graph summary">
          <span>
            <strong>{frameCount}</strong> frames
          </span>
          <span>
            <strong>{transformCount}</strong> transforms
          </span>
          <span>
            <strong>{visibleTrees.length}</strong> trees
          </span>
        </div>
      </div>

      <div className="tf-tree-menu-section">
        <span className="tf-tree-menu-label">Display</span>
        <label className="tf-tree-filter-field">
          <span>Filter frames</span>
          <input
            type="search"
            value={filterQuery}
            onChange={event => onFilterQueryChange(event.target.value)}
            placeholder="Frame name"
            aria-label="Filter TF frames"
          />
        </label>
        <div className="tf-tree-toggle-list">
          <label className="tf-tree-toggle-row">
            <span>Show static transforms</span>
            <input
              type="checkbox"
              checked={showStatic}
              onChange={event => onShowStaticChange(event.target.checked)}
              aria-label="Static TF"
            />
          </label>
          <label className="tf-tree-toggle-row">
            <span>Highlight stale transforms</span>
            <input
              type="checkbox"
              checked={highlightStale}
              onChange={event => onHighlightStaleChange(event.target.checked)}
              aria-label="Highlight stale"
            />
          </label>
        </div>
      </div>

      <div className="tf-tree-menu-list-section">
        <span className="tf-tree-menu-label">
          Visible Trees
          {visibleTrees.length > 0 && <span className="tf-tree-menu-count">{visibleTrees.length}</span>}
        </span>
        <div className="tf-tree-component-list">
          {visibleTrees.length === 0 ? (
            <div className="tf-tree-menu-empty">No visible TF trees</div>
          ) : (
            visibleTrees.map((tree, index) => (
              <button
                type="button"
                className="tf-tree-component-row"
                key={tree.id}
                onClick={() => onFocusTree(tree)}
                data-testid={`tf-tree-component-${index}`}
              >
                <span className="tf-tree-component-index">{index + 1}</span>
                <span className="tf-tree-component-copy">
                  <strong>{tree.rootFrame}</strong>
                  <span>
                    {tree.frames.length} frame{tree.frames.length === 1 ? '' : 's'}
                  </span>
                </span>
                <FaExpand aria-hidden="true" />
              </button>
            ))
          )}
        </div>
      </div>

      {warningCount > 0 && (
        <div className="tf-tree-menu-section tf-tree-diagnostics" role="alert">
          <span className="tf-tree-menu-label">Diagnostics</span>
          {multipleParents.map(warning => (
            <p key={`parents:${warning.childFrame}`}>
              <strong>{warning.childFrame}</strong> has multiple observed parents: {warning.parentFrames.join(', ')}
            </p>
          ))}
          {cycles.map(cycle => (
            <p key={`cycle:${cycle.join(':')}`}>
              Cycle detected: {cycle.join(' - ')} - {cycle[0]}
            </p>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      <TreePanelMenu
        open={menuOpen}
        onOpen={onMenuOpen}
        onClose={onMenuClose}
        triggerBarClassName="tf-tree-float-bar"
        triggerContent={<span className="tf-tree-menu-title">TF Tree</span>}
        triggerAfter={
          <>
            <button
              type="button"
              className="tf-tree-icon-button tf-tree-arrange-button"
              onClick={onArrange}
              title="Arrange TF tree"
              aria-label="Arrange TF tree"
              data-testid="tf-tree-arrange"
            >
              <svg
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
              type="button"
              className={`tf-tree-icon-button${calculatorOpen ? ' active' : ''}`}
              onClick={onToggleCalculator}
              title={calculatorOpen ? 'Hide TF calculator' : 'Open TF calculator'}
              aria-label={calculatorOpen ? 'Hide TF calculator' : 'Open TF calculator'}
              aria-pressed={calculatorOpen}
              data-testid="tf-tree-calculator-button"
            >
              <FaCalculator aria-hidden="true" />
            </button>
          </>
        }
        buttonLabel="Open TF tree menu"
        buttonTitle="TF tree controls and visible trees"
        warningCount={warningCount}
        buttonTestId="tf-tree-menu-button"
        panelTestId="tf-tree-menu-panel"
        panelLabel="TF tree menu"
        menuContent={menuContent}
        classNames={{ button: 'tf-tree-menu-button' }}
      />

      <div className="tf-tree-float-actions">
        <button
          type="button"
          className={`tf-tree-live-button${isPaused ? ' paused' : ''}`}
          onClick={isPaused ? onResume : onPause}
          title={isPaused ? 'Resume live TF updates' : 'Pause live TF updates'}
          aria-label={isPaused ? 'Resume live TF updates' : 'Pause live TF updates'}
        >
          {isPaused ? <FaPlay aria-hidden="true" /> : <FaPause aria-hidden="true" />}
          <span>{isPaused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>

      <TreePanelSearch
        className="tf-tree-search"
        query={searchQuery}
        onQueryChange={onSearchQueryChange}
        results={searchResults}
        onSelect={onSelectFrame}
        placeholder={frameCount > 0 ? 'Search TF frames...' : 'No frames to search'}
        ariaLabel="Search TF frame"
        emptyText="No matching frames"
        disabled={frameCount === 0}
        testId="tf-tree-search"
        listboxId="tf-frame-search-results"
      />
    </>
  );
};

export default TfTreeControls;
