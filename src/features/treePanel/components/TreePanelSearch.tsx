import React, { useEffect, useRef, useState } from 'react';

import './TreePanelChrome.css';

export interface TreePanelSearchResult<T> {
  id: string;
  label: string;
  value: T;
  detail?: string;
  badge?: string;
}

interface TreePanelSearchProps<T> {
  query: string;
  onQueryChange: (query: string) => void;
  results: TreePanelSearchResult<T>[];
  onSelect: (value: T) => void;
  ariaLabel: string;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  listboxId: string;
  inputId?: string;
}

const TreePanelSearch = <T,>({
  query,
  onQueryChange,
  results,
  onSelect,
  ariaLabel,
  placeholder,
  emptyText = 'No matches',
  disabled = false,
  className,
  testId,
  listboxId,
  inputId,
}: TreePanelSearchProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasQuery = query.trim().length > 0;

  useEffect(() => setActiveIndex(0), [query, results.length]);

  const selectResult = (index: number) => {
    const result = results[index];
    if (!result) return;
    onSelect(result.value);
    onQueryChange(result.label);
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
    } else if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      selectResult(isOpen ? activeIndex : 0);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setIsOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`tree-panel-search${hasQuery ? ' has-query' : ''}${className ? ` ${className}` : ''}`}
      role="search"
      onBlur={handleBlur}
      data-testid={testId}
    >
      <div className="tree-panel-search-field">
        <svg
          className="tree-panel-search-icon"
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
          id={inputId}
          className="tree-panel-search-input"
          type="search"
          value={query}
          onChange={event => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(hasQuery)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen && hasQuery}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        {hasQuery && (
          <button
            className="tree-panel-search-clear"
            type="button"
            onClick={() => {
              onQueryChange('');
              setIsOpen(false);
            }}
            aria-label="Clear search"
            title="Clear search"
          >
            x
          </button>
        )}
      </div>

      {isOpen && hasQuery && (
        <div className="tree-panel-search-menu">
          {results.length === 0 ? (
            <div className="tree-panel-search-empty" role="status">
              {emptyText}
            </div>
          ) : (
            <ul id={listboxId} className="tree-panel-search-results" role="listbox">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    id={`${listboxId}-${index}`}
                    className={`tree-panel-search-result${index === activeIndex ? ' active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(index)}
                  >
                    <span className="tree-panel-search-result-copy">
                      <span className="tree-panel-search-result-label">{result.label}</span>
                      {result.detail && result.detail !== result.label && (
                        <span className="tree-panel-search-result-detail">{result.detail}</span>
                      )}
                    </span>
                    {result.badge && <span className="tree-panel-search-result-badge">{result.badge}</span>}
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

export default TreePanelSearch;
