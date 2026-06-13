import React, { useEffect, useMemo, useRef, useState } from 'react';

import { searchBehaviorTreeNodes } from '../nodeSearch';
import { BehaviorTreeNode } from '../types';
import './NodeSearch.css';

interface NodeSearchProps {
  nodes: BehaviorTreeNode[];
  onSelectNode: (node: BehaviorTreeNode) => void;
}

const NodeSearch: React.FC<NodeSearchProps> = ({ nodes, onSelectNode }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchBehaviorTreeNodes(nodes, query), [nodes, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, nodes]);

  const selectResult = (index: number) => {
    const result = results[index];
    if (!result) return;

    onSelectNode(result.node);
    setQuery(result.label);
    setIsOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((activeIndex + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && isOpen && results.length > 0) {
      event.preventDefault();
      selectResult(activeIndex);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setIsOpen(false);
  };

  const listboxId = 'bt-node-search-results';
  const hasQuery = query.trim().length > 0;

  return (
    <div
      ref={rootRef}
      className={`bt-node-search${hasQuery ? ' has-query' : ''}`}
      role="search"
      onBlur={handleBlur}
      data-testid="bt-node-search"
    >
      <div className="bt-node-search-field">
        <svg
          className="bt-node-search-icon"
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <line x1="10" y1="10" x2="14" y2="14" />
        </svg>
        <input
          className="bt-node-search-input"
          type="search"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(hasQuery)}
          onKeyDown={handleKeyDown}
          placeholder={nodes.length > 0 ? 'Search tree nodes...' : 'No nodes to search'}
          aria-label="Search tree nodes"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen && hasQuery}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && results[activeIndex] ? `bt-node-search-result-${activeIndex}` : undefined}
          disabled={nodes.length === 0}
          autoComplete="off"
          spellCheck={false}
        />
        {hasQuery && (
          <button
            className="bt-node-search-clear"
            type="button"
            onClick={clearSearch}
            aria-label="Clear node search"
            title="Clear search"
          >
            x
          </button>
        )}
      </div>

      {isOpen && hasQuery && (
        <div className="bt-node-search-menu">
          {results.length === 0 ? (
            <div className="bt-node-search-empty" role="status">
              No matching nodes
            </div>
          ) : (
            <ul id={listboxId} className="bt-node-search-results" role="listbox">
              {results.map((result, index) => (
                <li key={result.node.id}>
                  <button
                    id={`bt-node-search-result-${index}`}
                    className={`bt-node-search-result${index === activeIndex ? ' active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(index)}
                  >
                    <span className="bt-node-search-result-copy">
                      <span className="bt-node-search-result-label">{result.label}</span>
                      {result.detail && result.detail !== result.label && (
                        <span className="bt-node-search-result-detail">{result.detail}</span>
                      )}
                    </span>
                    <span className="bt-node-search-result-type">{result.typeLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default NodeSearch;
