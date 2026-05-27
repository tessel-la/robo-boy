import React, { useRef, useCallback, useState, useEffect } from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig } from '../types';
import JoystickComponent from './JoystickComponent';
import ButtonComponent from './ButtonComponent';
import DPadComponent from './DPadComponent';
import ToggleComponent from './ToggleComponent';
import SliderComponent from './SliderComponent';
import './GamepadComponent.css';

interface GamepadComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  isSelected?: boolean;
  isBeingDragged?: boolean;
  scaleFactor?: number;
  gridSize?: { width: number; height: number };
  onSelect?: (id: string) => void;
  onUpdate?: (config: GamepadComponentConfig) => void;
  onDelete?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

const GamepadComponent: React.FC<GamepadComponentProps> = ({
  config,
  ros,
  isEditing = false,
  isSelected = false,
  isBeingDragged = false,
  scaleFactor = 1,
  gridSize = { width: 8, height: 4 },
  onSelect,
  onUpdate,
  onDelete,
  onOpenSettings,
  onDragStart,
  onDragEnd
}) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null);
  const [showControls, setShowControls] = useState(false);
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    position: { x: number; y: number; width: number; height: number };
    cellWidth: number;
    cellHeight: number;
  } | null>(null);

  // Hide controls when deselected
  useEffect(() => {
    if (!isSelected) {
      setShowControls(false);
    }
  }, [isSelected]);

  const handleClick = (e: React.MouseEvent) => {
    if (isEditing && !isResizing) {
      e.stopPropagation();
      if (isSelected) {
        // Toggle controls visibility when already selected
        setShowControls(prev => !prev);
      } else if (onSelect) {
        // Select the component (controls hidden by default)
        onSelect(config.id);
      }
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(config.id);
    }
  };

  const handleOpenSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenSettings) {
      onOpenSettings(config.id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!isEditing || !isSelected || isResizing) return;
    
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', config.id);
    e.dataTransfer.effectAllowed = 'move';
    
    // Create simple drag image
    const dragImage = document.createElement('div');
    dragImage.innerHTML = `<span>${config.label || config.type}</span>`;
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
    
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
    
    if (onDragStart) {
      onDragStart(config.id);
    }
  };

  const handleDragEnd = () => {
    if (onDragEnd) {
      onDragEnd();
    }
  };

  // Get cell dimensions from the grid
  const getCellDimensions = useCallback(() => {
    if (!componentRef.current) return { cellWidth: 80, cellHeight: 80 };
    
    const gridEl = componentRef.current.closest('.gamepad-grid') as HTMLElement;
    if (!gridEl) return { cellWidth: 80, cellHeight: 80 };
    
    const gridRect = gridEl.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(gridEl);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 8;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 8;
    
    const innerWidth = gridRect.width - paddingLeft * 2;
    const innerHeight = gridRect.height - paddingTop * 2;
    
    return {
      cellWidth: innerWidth / gridSize.width,
      cellHeight: innerHeight / gridSize.height
    };
  }, [gridSize]);

  // Resize handle mouse down
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent, handle: ResizeHandle) => {
    if (!isEditing || !isSelected || !onUpdate) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const { cellWidth, cellHeight } = getCellDimensions();
    
    resizeStartRef.current = {
      x: clientX,
      y: clientY,
      position: { ...config.position },
      cellWidth,
      cellHeight
    };
    
    setIsResizing(true);
    setActiveHandle(handle);
  }, [isEditing, isSelected, onUpdate, getCellDimensions, config.position]);

  // Handle resize move
  const handleResizeMove = useCallback((clientX: number, clientY: number) => {
    if (!isResizing || !resizeStartRef.current || !onUpdate || !activeHandle) return;
    
    const { x: startX, y: startY, position, cellWidth, cellHeight } = resizeStartRef.current;
    
    const deltaX = clientX - startX;
    const deltaY = clientY - startY;
    
    // Convert pixel delta to grid cells
    const cellDeltaX = Math.round(deltaX / cellWidth);
    const cellDeltaY = Math.round(deltaY / cellHeight);
    
    let newX = position.x;
    let newY = position.y;
    let newWidth = position.width;
    let newHeight = position.height;
    
    // Apply deltas based on which handle is being dragged
    if (activeHandle.includes('e')) {
      newWidth = Math.max(1, Math.min(position.width + cellDeltaX, gridSize.width - position.x));
    }
    if (activeHandle.includes('w')) {
      const widthChange = Math.min(cellDeltaX, position.width - 1);
      const actualChange = Math.max(-position.x, widthChange);
      newX = position.x + actualChange;
      newWidth = position.width - actualChange;
    }
    if (activeHandle.includes('s')) {
      newHeight = Math.max(1, Math.min(position.height + cellDeltaY, gridSize.height - position.y));
    }
    if (activeHandle.includes('n')) {
      const heightChange = Math.min(cellDeltaY, position.height - 1);
      const actualChange = Math.max(-position.y, heightChange);
      newY = position.y + actualChange;
      newHeight = position.height - actualChange;
    }
    
    // Only update if something changed
    if (newX !== config.position.x || newY !== config.position.y || 
        newWidth !== config.position.width || newHeight !== config.position.height) {
      onUpdate({
        ...config,
        position: {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        }
      });
    }
  }, [isResizing, activeHandle, onUpdate, config, gridSize]);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setActiveHandle(null);
    resizeStartRef.current = null;
  }, []);

  // Global mouse/touch event listeners for resize
  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      handleResizeMove(e.clientX, e.clientY);
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleResizeMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    
    const handleMouseUp = () => {
      handleResizeEnd();
    };
    
    const handleTouchEnd = () => {
      handleResizeEnd();
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Touch handling for component body - differentiate between tap and drag
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);
  const DRAG_THRESHOLD = 10;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isEditing) return;
    
    // Don't start drag if touching a resize handle or control button
    const target = e.target as HTMLElement;
    if (target.classList.contains('component-resize-handle')) return;
    if (target.classList.contains('control-button') || target.closest('.control-button')) return;
    if (target.closest('.component-controls-popup')) return;
    
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
    isDraggingRef.current = false;
  }, [isEditing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isEditing || !touchStartRef.current || !isSelected) return;
    
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
    
    if (!isDraggingRef.current && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
      isDraggingRef.current = true;
      e.stopPropagation();
      if (onDragStart) {
        onDragStart(config.id);
      }
    }
  }, [isEditing, isSelected, onDragStart, config.id]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isEditing || !touchStartRef.current) return;
    
    if (!isDraggingRef.current) {
      e.stopPropagation();
      if (isSelected) {
        // Toggle controls visibility when already selected
        setShowControls(prev => !prev);
      } else if (onSelect) {
        // Select the component (controls hidden by default)
        onSelect(config.id);
      }
    }
    
    touchStartRef.current = null;
    isDraggingRef.current = false;
  }, [isEditing, isSelected, onSelect, config.id]);

  // Touch handlers for control buttons - prevent component toggle
  const handleButtonTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    // Prevent component touch handler from recording this touch
  }, []);

  const handleButtonTouchEnd = useCallback((e: React.TouchEvent, action: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    action();
  }, []);

  const renderComponent = () => {
    const commonProps = {
      config,
      ros,
      isEditing,
      scaleFactor
    };

    switch (config.type) {
      case 'joystick':
        return <JoystickComponent {...commonProps} />;
      case 'button':
        return <ButtonComponent {...commonProps} />;
      case 'dpad':
        return <DPadComponent {...commonProps} />;
      case 'toggle':
        return <ToggleComponent {...commonProps} />;
      case 'slider':
        return <SliderComponent {...commonProps} />;
      default:
        return <div className="unknown-component">Unknown component type</div>;
    }
  };

  const style: React.CSSProperties = {
    gridColumn: `${config.position.x + 1} / span ${config.position.width}`,
    gridRow: `${config.position.y + 1} / span ${config.position.height}`,
    position: 'relative',
    // Animate size changes during resize
    transition: isResizing ? 'none' : 'grid-column 0.2s ease, grid-row 0.2s ease'
  };

  const getComponentClass = () => {
    let className = `gamepad-component ${config.type}`;
    if (isEditing) className += ' editing';
    if (isBeingDragged) className += ' being-dragged';
    if (isSelected) className += ' selected';
    if (isResizing) className += ' resizing';
    return className;
  };

  return (
    <div
      ref={componentRef}
      className={getComponentClass()}
      style={style}
      onClick={handleClick}
      draggable={isEditing && isSelected && !isResizing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-component-id={config.id}
    >
      {renderComponent()}
      
      {/* Label */}
      {config.label && (
        <div className="component-label" style={{ fontSize: `${0.7 * scaleFactor}em` }}>
          {config.label}
        </div>
      )}
      
      {/* Editing controls - only when selected AND controls toggled on */}
      {isEditing && isSelected && showControls && (
        <div className={`component-controls-popup ${config.position.y === 0 ? 'popup-below' : ''}`}>
          <button
            className="control-button settings-button"
            onClick={handleOpenSettings}
            onTouchStart={handleButtonTouchStart}
            onTouchEnd={(e) => handleButtonTouchEnd(e, () => onOpenSettings?.(config.id))}
            title="Settings"
          >
            ⚙
          </button>
          <button
            className="control-button delete-button"
            onClick={handleDelete}
            onTouchStart={handleButtonTouchStart}
            onTouchEnd={(e) => handleButtonTouchEnd(e, () => onDelete?.(config.id))}
            title="Delete"
          >
            🗑
          </button>
        </div>
      )}

      {/* Resize handles - only when selected */}
      {isEditing && isSelected && (
        <div className="component-resize-handles">
            {/* Corner handles */}
            <div 
              className={`component-resize-handle corner nw ${activeHandle === 'nw' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'nw')}
              onTouchStart={(e) => handleResizeStart(e, 'nw')}
            />
            <div 
              className={`component-resize-handle corner ne ${activeHandle === 'ne' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'ne')}
              onTouchStart={(e) => handleResizeStart(e, 'ne')}
            />
            <div 
              className={`component-resize-handle corner sw ${activeHandle === 'sw' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'sw')}
              onTouchStart={(e) => handleResizeStart(e, 'sw')}
            />
            <div 
              className={`component-resize-handle corner se ${activeHandle === 'se' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'se')}
              onTouchStart={(e) => handleResizeStart(e, 'se')}
            />
            
            {/* Edge handles */}
            <div 
              className={`component-resize-handle edge n ${activeHandle === 'n' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'n')}
              onTouchStart={(e) => handleResizeStart(e, 'n')}
            />
            <div 
              className={`component-resize-handle edge s ${activeHandle === 's' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 's')}
              onTouchStart={(e) => handleResizeStart(e, 's')}
            />
            <div 
              className={`component-resize-handle edge w ${activeHandle === 'w' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'w')}
              onTouchStart={(e) => handleResizeStart(e, 'w')}
            />
            <div 
              className={`component-resize-handle edge e ${activeHandle === 'e' ? 'active' : ''}`}
              onMouseDown={(e) => handleResizeStart(e, 'e')}
              onTouchStart={(e) => handleResizeStart(e, 'e')}
            />
        </div>
      )}
    </div>
  );
};

export default GamepadComponent;
