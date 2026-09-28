import React, { useRef, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { FiSettings, FiTrash2 } from 'react-icons/fi';
import type { Ros } from 'roslib';
import { GamepadComponentConfig, JoyAxesPublisher, TwistAxesPublisher } from '../types';
import { measureGridCells, resizeWithin, type GridRect, type ResizeEdge } from '../padGeometry';
import JoystickComponent from './JoystickComponent';
import ButtonComponent from './ButtonComponent';
import DPadComponent from './DPadComponent';
import ToggleComponent from './ToggleComponent';
import SliderComponent from './SliderComponent';
import CameraComponent from './CameraComponent';
import PlotComponent from './PlotComponent';
import HeartbeatComponent from './HeartbeatComponent';
import PhysicalGamepadComponent from './PhysicalGamepadComponent';
import './GamepadComponent.css';

interface GamepadComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  isSelected?: boolean;
  isBeingDragged?: boolean;
  scaleFactor?: number;
  gridSize?: { width: number; height: number };
  /** Where the other components are, so a resize stops at them. */
  occupied?: readonly GridRect[];
  onSelect?: (id: string) => void;
  onUpdate?: (config: GamepadComponentConfig) => void;
  onDelete?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onJoyAxesChange?: JoyAxesPublisher;
  onTwistAxesChange?: TwistAxesPublisher;
}

type ResizeHandle = ResizeEdge | null;
type ControlsPlacement = 'above' | 'below' | 'inside';

const RESIZE_EDGES: ResizeEdge[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];
const EDGE_LABELS: Record<ResizeEdge, string> = {
  n: 'top edge', s: 'bottom edge', e: 'right edge', w: 'left edge',
  nw: 'top-left corner', ne: 'top-right corner', sw: 'bottom-left corner', se: 'bottom-right corner',
};
/** Below this size (px) a component shows its corner handles only: edge grips would crowd it. */
const COMPACT_PX = 64;
const NO_OCCUPIED: readonly GridRect[] = [];

const GamepadComponent: React.FC<GamepadComponentProps> = ({
  config,
  ros,
  isEditing = false,
  isSelected = false,
  isBeingDragged = false,
  scaleFactor = 1,
  gridSize = { width: 8, height: 4 },
  occupied = NO_OCCUPIED,
  onSelect,
  onUpdate,
  onDelete,
  onOpenSettings,
  onDragStart,
  onDragEnd,
  onJoyAxesChange,
  onTwistAxesChange
}) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null);
  const [isCompact, setIsCompact] = useState(false);
  const resizeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    position: GridRect;
    columnStep: number;
    rowStep: number;
  } | null>(null);

  // Small components keep only their corner handles.
  useLayoutEffect(() => {
    if (!isEditing || !isSelected || !componentRef.current) return;
    const rect = componentRef.current.getBoundingClientRect();
    setIsCompact(rect.width < COMPACT_PX || rect.height < COMPACT_PX);
  }, [isEditing, isSelected, config.position.width, config.position.height, scaleFactor]);

  // Selecting shows the handles and the toolbar together; a click on a selected component leaves it selected.
  const handleClick = (e: React.MouseEvent) => {
    if (isEditing && !isResizing) {
      e.stopPropagation();
      if (!isSelected) onSelect?.(config.id);
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
    // A press on a resize handle is a resize, even if the pointer moves before React has re-rendered.
    if (resizeStartRef.current) { e.preventDefault(); return; }
    if (!isEditing || !isSelected || isResizing) return;
    
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', config.id);
    e.dataTransfer.effectAllowed = 'move';
    
    const dragImage = document.createElement('div');
    dragImage.className = 'pad-drag-ghost';
    dragImage.textContent = config.label || config.type;
    const size = document.createElement('small');
    size.textContent = `${config.position.width}×${config.position.height}`;
    dragImage.appendChild(size);
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

  // The step between columns and rows of the rendered grid, which is what a pointer moves across.
  const measureSteps = useCallback(() => {
    const gridEl = componentRef.current?.closest('.gamepad-grid');
    const cells = gridEl ? measureGridCells(gridEl, gridSize) : null;
    if (cells) return { columnStep: cells.columnStep, rowStep: cells.rowStep };
    const box = componentRef.current?.getBoundingClientRect();
    return {
      columnStep: box && box.width > 0 ? box.width / config.position.width : 80,
      rowStep: box && box.height > 0 ? box.height / config.position.height : 80,
    };
  }, [gridSize, config.position.width, config.position.height]);

  // Resizing follows one pointer (mouse, touch or pen), captured by the handle it pressed.
  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>, handle: ResizeEdge) => {
    if (!isEditing || !isSelected || !onUpdate) return;
    e.stopPropagation();
    e.preventDefault();
    // Firefox would otherwise start dragging the whole component from this press before React re-renders.
    if (componentRef.current) componentRef.current.draggable = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resizeStartRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, position: { ...config.position }, ...measureSteps() };
    setIsResizing(true);
    setActiveHandle(handle);
  }, [isEditing, isSelected, onUpdate, config.position, measureSteps]);

  const handleResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeStartRef.current && e.pointerId !== resizeStartRef.current.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    resizeStartRef.current = null;
    setIsResizing(false);
    setActiveHandle(null);
  }, []);

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start || e.pointerId !== start.pointerId || !activeHandle || !onUpdate) return;
    // A mouse whose button is no longer held has let go somewhere the handle did not hear.
    if (e.pointerType === 'mouse' && e.buttons === 0) { handleResizeEnd(e); return; }
    e.preventDefault();
    const next = resizeWithin(
      start.position,
      activeHandle,
      Math.round((e.clientX - start.x) / start.columnStep),
      Math.round((e.clientY - start.y) / start.rowStep),
      gridSize,
      occupied
    );
    const current = config.position;
    if (next.x !== current.x || next.y !== current.y || next.width !== current.width || next.height !== current.height) {
      onUpdate({ ...config, position: next });
    }
  }, [activeHandle, onUpdate, config, gridSize, occupied, handleResizeEnd]);


  // Touch handling for component body - differentiate between tap and drag
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);
  const DRAG_THRESHOLD = 10;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isEditing) return;
    
    // Don't start drag if touching a resize handle or control button
    const target = e.target as HTMLElement;
    if (target.closest('.component-resize-handle')) return;
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
      if (!isSelected) onSelect?.(config.id);
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
        return (
          <JoystickComponent
            {...commonProps}
            onJoyAxesChange={onJoyAxesChange}
            onTwistAxesChange={onTwistAxesChange}
          />
        );
      case 'physical-gamepad':
        return <PhysicalGamepadComponent {...commonProps} />;
      case 'button':
        return <ButtonComponent {...commonProps} />;
      case 'dpad':
        return <DPadComponent {...commonProps} />;
      case 'toggle':
        return <ToggleComponent {...commonProps} />;
      case 'slider':
        return <SliderComponent {...commonProps} />;
      case 'camera':
        return <CameraComponent {...commonProps} />;
      case 'plot':
        return <PlotComponent {...commonProps} />;
      case 'heartbeat':
        return <HeartbeatComponent {...commonProps} />;
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
    const typeClass = config.type === 'dpad' ? 'component-dpad' : config.type;
    let className = `gamepad-component ${typeClass}`;
    if (isEditing) className += ' editing';
    if (isBeingDragged) className += ' being-dragged';
    if (isSelected) className += ' selected';
    if (isResizing) className += ' resizing';
    return className;
  };

  const getControlsPlacement = (): ControlsPlacement => {
    const touchesTop = config.position.y <= 0;
    const touchesBottom = config.position.y + config.position.height >= gridSize.height;

    if (touchesTop && touchesBottom) {
      return 'inside';
    }

    if (touchesTop) {
      return 'below';
    }

    return 'above';
  };

  const controlsPlacement = getControlsPlacement();

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
      {config.label && config.type !== 'heartbeat' && (
        <div className="component-label" style={{ fontSize: `${0.7 * scaleFactor}em` }}>
          {config.label}
        </div>
      )}
      
      {/* Size while resizing */}
      {isEditing && isResizing && (
        <div className="component-size-badge" aria-live="polite">
          {config.position.width} × {config.position.height}
        </div>
      )}

      {/* The selected component's tools: its size, its settings, removing it */}
      {isEditing && isSelected && !isResizing && !isBeingDragged && (
        <div
          className={`component-controls-popup popup-${controlsPlacement}`}
          role="toolbar"
          aria-label={`${config.label || config.type} tools`}
        >
          <span className="component-controls-size" title="Size in grid cells">
            {config.position.width}×{config.position.height}
          </span>
          <button
            type="button"
            className="control-button settings-button"
            onClick={handleOpenSettings}
            onTouchStart={handleButtonTouchStart}
            onTouchEnd={(e) => handleButtonTouchEnd(e, () => onOpenSettings?.(config.id))}
            title="Settings"
            aria-label="Settings"
          >
            <FiSettings aria-hidden="true" />
          </button>
          <button
            type="button"
            className="control-button delete-button"
            onClick={handleDelete}
            onTouchStart={handleButtonTouchStart}
            onTouchEnd={(e) => handleButtonTouchEnd(e, () => onDelete?.(config.id))}
            title="Delete"
            aria-label="Delete"
          >
            <FiTrash2 aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Resize handles - only when selected */}
      {isEditing && isSelected && (
        <div className={`component-resize-handles ${isCompact ? 'is-compact' : ''} ${isResizing ? 'is-resizing' : ''}`}>
          {RESIZE_EDGES.map(edge => (
            <div
              key={edge}
              className={`component-resize-handle ${edge.length === 2 ? 'corner' : 'edge'} ${edge} ${activeHandle === edge ? 'active' : ''}`}
              role="presentation"
              aria-label={`Resize from the ${EDGE_LABELS[edge]}`}
              draggable={false}
              onPointerDown={(e) => handleResizeStart(e, edge)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default GamepadComponent;
