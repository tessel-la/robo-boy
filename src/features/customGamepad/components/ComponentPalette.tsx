import React, { useState, useRef, useEffect } from 'react';
import { componentLibrary } from '../defaultLayouts';
import ButtonComponent from './ButtonComponent';
import JoystickComponent from './JoystickComponent';
import DPadComponent from './DPadComponent';
import ToggleComponent from './ToggleComponent';
import SliderComponent from './SliderComponent';
import './ComponentPalette.css';

interface ComponentPaletteProps {
  selectedComponent: string | null;
  onComponentSelect: (componentType: string) => void;
  onDragStart?: (componentType: string) => void;
  onDragEnd?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  forceCollapsed?: boolean;
}

const ComponentPalette: React.FC<ComponentPaletteProps> = ({
  selectedComponent,
  onComponentSelect,
  onDragStart,
  onDragEnd,
  onExpandedChange,
  forceCollapsed = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  const [draggingComponent, setDraggingComponent] = useState<string | null>(null);

  // Mock ros object for preview components
  const mockRos = {
    connect: () => {},
    close: () => {},
    on: () => {},
    off: () => {}
  } as any;

  // Force collapse when other component expands
  useEffect(() => {
    if (forceCollapsed && isExpanded) {
      setIsExpanded(false);
    }
  }, [forceCollapsed, isExpanded]);

  const renderComponentPreview = (componentType: string, size: 'small' | 'medium' = 'small') => {
    const mockConfig = {
      id: `preview-${componentType}`,
      type: componentType as any,
      position: { x: 0, y: 0, width: 1, height: 1 },
      label: componentType === 'dpad' ? '' : componentLibrary.find(c => c.type === componentType)?.name || '',
      action: {
        topic: '/preview',
        messageType: 'sensor_msgs/Joy'
      },
      config: componentType === 'button' ? { momentary: true } : {}
    };

    const previewStyle: React.CSSProperties = {
      width: size === 'small' ? '40px' : '60px',
      height: size === 'small' ? '40px' : '60px',
      pointerEvents: 'none',
      transform: size === 'small' ? 'scale(0.8)' : 'scale(1)',
      opacity: 0.9
    };

    const containerStyle: React.CSSProperties = {
      ...previewStyle,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: '4px',
      backgroundColor: 'var(--background-secondary, #f8f9fa)'
    };

    const componentProps = {
      config: mockConfig,
      ros: mockRos,
      isEditing: true,
      scaleFactor: size === 'small' ? 0.6 : 0.8
    };

    return (
      <div style={containerStyle}>
        {componentType === 'button' && <ButtonComponent {...componentProps} />}
        {componentType === 'joystick' && <JoystickComponent {...componentProps} />}
        {componentType === 'dpad' && <DPadComponent {...componentProps} />}
        {componentType === 'toggle' && <ToggleComponent {...componentProps} />}
        {componentType === 'slider' && <SliderComponent {...componentProps} />}
      </div>
    );
  };

  const toggleExpanded = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    onExpandedChange?.(newExpanded);
  };

  const handleDragStart = (e: React.DragEvent, componentType: string) => {
    setDraggingComponent(componentType);
    onDragStart?.(componentType);
    
    // Set drag data
    e.dataTransfer.setData('text/plain', componentType);
    e.dataTransfer.effectAllowed = 'copy';
    
    // Create a custom drag image (simple styling matching app)
    const dragImage = document.createElement('div');
    dragImage.className = 'drag-ghost';
    dragImage.innerHTML = `<span>${componentLibrary.find(c => c.type === componentType)?.name || componentType}</span>`;
    dragImage.style.cssText = `
      position: absolute;
      top: -1000px;
      padding: 8px 12px;
      background: var(--primary-color, #007bff);
      color: white;
      border-radius: 6px;
      font-weight: 500;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      z-index: 10000;
    `;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 40, 20);
    
    // Clean up the drag image after a short delay
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
  };

  const handleDragEnd = () => {
    setDraggingComponent(null);
    onDragEnd?.();
  };

  // Touch event handlers for mobile
  const handleTouchStart = (componentType: string) => {
    setDraggingComponent(componentType);
    onDragStart?.(componentType);
  };

  const handleTouchEnd = () => {
    // Don't clear dragging state here - let parent handle the drop
    // The parent will call onDragEnd when the drop is complete
  };

  // Determine if we're in the buttons row (parent has sidebar-buttons-row class)
  const containerRef = useRef<HTMLDivElement>(null);

  // Check on every render if in buttons row
  const currentIsInButtonsRow = containerRef.current?.parentElement?.classList.contains('sidebar-buttons-row') || false;

  return (
    <div ref={containerRef} className={`component-palette ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Collapsed State - only shown in buttons row */}
      {currentIsInButtonsRow && (
        <div className="palette-collapsed">
          <div className="collapsed-content">
            <h3 className="collapsed-title">component</h3>
            <button 
              className="tools-icon-button"
              onClick={toggleExpanded}
              aria-label="Open component gallery"
            >
              <svg 
                className="tools-icon" 
                viewBox="0 0 24 24" 
                fill="currentColor"
              >
                <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4zM6.7 8.8c-.7.7-1.9.7-2.6 0-.7-.7-.7-1.9 0-2.6.7-.7 1.9-.7 2.6 0 .7.7.7 1.9 0 2.6z"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Expanded State - shown when in expanded area OR when expanded in buttons row */}
      {!currentIsInButtonsRow && (
        <>
          <div className="palette-content">
            <div className="component-grid">
              {componentLibrary.map(component => {
                const isSelected = selectedComponent === component.type;
                const isHovered = hoveredComponent === component.type;
                const isDragging = draggingComponent === component.type;
                
                return (
                  <div
                    key={component.type}
                    className={`component-card ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''} ${isDragging ? 'dragging' : ''}`}
                    draggable
                    onClick={() => onComponentSelect(component.type)}
                    onDragStart={(e) => handleDragStart(e, component.type)}
                    onDragEnd={handleDragEnd}
                    onTouchStart={() => handleTouchStart(component.type)}
                    onTouchEnd={handleTouchEnd}
                    onMouseEnter={() => setHoveredComponent(component.type)}
                    onMouseLeave={() => setHoveredComponent(null)}
                    title={`Drag to grid or tap to select - ${component.description}`}
                  >
                    <div className="component-info">
                      <div className="component-preview">
                        {renderComponentPreview(component.type)}
                      </div>
                      <div className="component-details">
                        <div className="component-name">{component.name}</div>
                        <div className="component-description">{component.description}</div>
                      </div>
                    </div>
                    <div className="component-size">
                      {component.defaultSize.width}×{component.defaultSize.height}
                    </div>
                    <div className="drag-indicator">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <circle cx="9" cy="6" r="1.5"/>
                        <circle cx="15" cy="6" r="1.5"/>
                        <circle cx="9" cy="12" r="1.5"/>
                        <circle cx="15" cy="12" r="1.5"/>
                        <circle cx="9" cy="18" r="1.5"/>
                        <circle cx="15" cy="18" r="1.5"/>
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {selectedComponent && (
              <div className="selection-hint">
                <div className="hint-content">
                  <div className="hint-preview">
                    {renderComponentPreview(selectedComponent, 'medium')}
                  </div>
                  <div className="hint-text">
                    <strong>{componentLibrary.find(c => c.type === selectedComponent)?.name}</strong> selected
                    <br />
                    <small>Click on the grid to place this component</small>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ComponentPalette; 