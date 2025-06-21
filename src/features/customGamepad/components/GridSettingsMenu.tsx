import React, { useState, useEffect, useRef } from 'react';
import './GridSettingsMenu.css';

interface GridSettingsMenuProps {
  layoutName: string;
  layoutDescription: string;
  gridWidth: number;
  gridHeight: number;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onGridSizeChange: (width: number, height: number) => void;
  onExpandedChange?: (expanded: boolean) => void;
  forceCollapsed?: boolean;
}

const GridSettingsMenu: React.FC<GridSettingsMenuProps> = ({
  layoutName,
  layoutDescription,
  gridWidth,
  gridHeight,
  onNameChange,
  onDescriptionChange,
  onGridSizeChange,
  onExpandedChange,
  forceCollapsed = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Force collapse when other component expands
  useEffect(() => {
    if (forceCollapsed && isExpanded) {
      setIsExpanded(false);
    }
  }, [forceCollapsed, isExpanded]);

  const toggleExpanded = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    onExpandedChange?.(newExpanded);
  };

  const handleWidthChange = (delta: number) => {
    const newWidth = Math.max(1, Math.min(16, gridWidth + delta));
    onGridSizeChange(newWidth, gridHeight);
  };

  const handleHeightChange = (delta: number) => {
    const newHeight = Math.max(1, Math.min(12, gridHeight + delta));
    onGridSizeChange(gridWidth, newHeight);
  };

  // Determine if we're in the buttons row (parent has sidebar-buttons-row class)
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInButtonsRow, setIsInButtonsRow] = useState(false);

  useEffect(() => {
    const checkParent = () => {
      if (containerRef.current) {
        const parent = containerRef.current.parentElement;
        const inButtonsRow = parent?.classList.contains('sidebar-buttons-row') || false;
        setIsInButtonsRow(inButtonsRow);
      }
    };
    
    checkParent();
    // Check again on next tick to ensure DOM is ready
    const timeoutId = setTimeout(checkParent, 0);
    
    return () => clearTimeout(timeoutId);
  }, []);

  // Also check on every render to be safe
  const currentIsInButtonsRow = containerRef.current?.parentElement?.classList.contains('sidebar-buttons-row') || false;

  return (
    <div ref={containerRef} className={`grid-settings-menu ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Collapsed State - only shown in buttons row */}
      {currentIsInButtonsRow && (
        <div className="settings-collapsed">
          <div className="collapsed-content">
            <h3 className="collapsed-title">Settings</h3>
            <button 
              className="grid-icon-button"
              onClick={toggleExpanded}
              aria-label="Open grid settings"
              title="Configure grid layout and pad name"
            >
              <svg 
                className="grid-icon" 
                viewBox="0 0 24 24" 
                fill="currentColor"
              >
                <path d="M10 2v2H8V2H10m6 0v2h-2V2H16m-6 4v2H8V6H10m6 0v2h-2V6H16M4 6v2H2V6H4m0 6v2H2v-2H4M2 2v2h2V2H2m0 6v2h2V8H2m0 6v2h2v-2H2m8 6v2H8v-2H10m6 0v2h-2v-2H16m-6-4v2H8v-2H10m6 0v2h-2v-2H16M4 18v2H2v-2H4m16-16v2h-2V2H20m0 6v2h-2V8H20m0 6v2h-2v-2H20m0 6v2h-2v-2H20M10 10v2H8v-2H10m6 0v2h-2v-2H16"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Expanded State - shown when in expanded area */}
      {!currentIsInButtonsRow && (
        <>
          <div className="settings-content">
            {/* Grid Size Controls - Now the primary setting */}
            <div className="settings-section">
              <h4>Grid Layout</h4>
              
              {/* Row and Column controls on same row with 50/50 split */}
              <div className="grid-controls-row">
                <div className="grid-control compact">
                  <label>Width: {gridWidth}</label>
                  <div className="control-buttons">
                    <button
                      className="control-btn minus"
                      onClick={() => handleWidthChange(-1)}
                      disabled={gridWidth <= 1}
                      title="Decrease width"
                    >
                      −
                    </button>
                    <span className="control-value">{gridWidth}</span>
                    <button
                      className="control-btn plus"
                      onClick={() => handleWidthChange(1)}
                      disabled={gridWidth >= 16}
                      title="Increase width"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="grid-control compact">
                  <label>Height: {gridHeight}</label>
                  <div className="control-buttons">
                    <button
                      className="control-btn minus"
                      onClick={() => handleHeightChange(-1)}
                      disabled={gridHeight <= 1}
                      title="Decrease height"
                    >
                      −
                    </button>
                    <span className="control-value">{gridHeight}</span>
                    <button
                      className="control-btn plus"
                      onClick={() => handleHeightChange(1)}
                      disabled={gridHeight >= 12}
                      title="Increase height"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid-info">
                <small>Grid size: {gridWidth} × {gridHeight} cells ({gridWidth * gridHeight} total)</small>
              </div>
            </div>

            {/* Description section */}
            <div className="settings-section">
              <h4>Description</h4>
              <div className="settings-group">
                <textarea
                  value={layoutDescription}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  rows={2}
                  placeholder="Optional description..."
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GridSettingsMenu; 