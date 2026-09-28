import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FiGrid, FiSliders, FiX } from 'react-icons/fi';
import type { Ros } from 'roslib';
import { 
  CustomGamepadLayout, 
  GamepadComponentConfig, 
  EditorState
} from '../types';
import { componentLibrary } from '../defaultLayouts';
import { fitNewComponent, isAreaFree, measureGridCells, occupiedExtent, type GridPoint, type GridRect } from '../padGeometry';
import { DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ } from '../physicalGamepad';
import { generateGamepadId, saveCustomGamepad } from '../gamepadStorage';
import LayoutRenderer from './CustomGamepadLayout';
import ComponentPalette from './ComponentPalette';
import GridSettingsMenu from './GridSettingsMenu';
import ComponentSettingsModal from './ComponentSettingsModal';
import './GamepadEditor.css';

interface GamepadEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (layout: CustomGamepadLayout) => void;
  initialLayout?: CustomGamepadLayout | null;
  ros: Ros;
}

type EditorToolPanel = 'components' | 'layout';

const GamepadEditor: React.FC<GamepadEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  initialLayout,
  ros
}) => {
  const [layout, setLayout] = useState<CustomGamepadLayout>(() => {
    if (initialLayout) {
      return { ...initialLayout };
    }
    
    return {
      id: generateGamepadId('new-gamepad'),
      name: 'New Gamepad',
      description: '',
      gridSize: { width: 8, height: 4 },
      cellSize: 80,
      components: [],
      rosConfig: {
        defaultTopic: '/joy',
        defaultMessageType: 'sensor_msgs/Joy'
      },
      metadata: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        version: '1.0.0'
      }
    };
  });

  const [editorState, setEditorState] = useState<EditorState>({
    selectedComponentId: null,
    draggedComponent: null,
    dragState: null,
    dropPreview: null,
    gridSize: layout.gridSize,
    cellSize: layout.cellSize,
    showGrid: true,
    snapToGrid: true
  });

  const designAreaRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  
  // Use ref for synchronous drag state access (React state is async and causes race conditions)
  const dragStateRef = useRef<EditorState['dragState']>(null);

  // Settings modal state
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsComponent, setSettingsComponent] = useState<GamepadComponentConfig | null>(null);

  const [activeToolPanel, setActiveToolPanel] = useState<EditorToolPanel | null>('components');

  const handleLayoutNameChange = useCallback((name: string) => {
    setLayout(prev => ({ ...prev, name }));
  }, []);

  const handleLayoutDescriptionChange = useCallback((description: string) => {
    setLayout(prev => ({ ...prev, description }));
  }, []);

  // The grid never shrinks from under a component: it stops at the last column and row in use.
  const contentExtent = occupiedExtent(layout.components);
  const handleGridSizeChange = useCallback((width: number, height: number) => {
    setLayout(prev => {
      const extent = occupiedExtent(prev.components);
      return { ...prev, gridSize: { width: Math.max(width, extent.width), height: Math.max(height, extent.height) } };
    });
    setEditorState(prev => ({
      ...prev,
      gridSize: { width, height }
    }));
  }, []);

  // Adds a component where it was placed, at the size that fitted there (see placementFor).
  const handleAddComponent = useCallback((componentType: string, placement: GridRect) => {
    const componentDef = componentLibrary.find(c => c.type === componentType);
    if (!componentDef) return;

    let action: { topic: string; messageType: string; field?: string } = {
      topic: `/${componentType}`,
      messageType: 'sensor_msgs/Joy',
    };

    switch (componentType) {
      case 'joystick':
        action = { topic: '/joystick', messageType: 'sensor_msgs/Joy', field: 'axes' };
        break;
      case 'physical-gamepad':
        action = { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' };
        break;
      case 'dpad':
        action = { topic: '/dpad', messageType: 'sensor_msgs/Joy', field: 'buttons' };
        break;
      case 'button':
        action = { topic: '/button', messageType: 'std_msgs/Bool', field: 'data' };
        break;
      case 'toggle':
        action = { topic: '/toggle', messageType: 'std_msgs/Bool', field: 'data' };
        break;
      case 'slider':
        action = { topic: '/slider', messageType: 'std_msgs/Float32', field: 'data' };
        break;
      case 'camera':
        action = { topic: '/camera/image_raw', messageType: 'sensor_msgs/Image' };
        break;
      case 'plot':
        action = { topic: '/plot', messageType: 'std_msgs/Float32', field: 'data' };
        break;
      case 'heartbeat':
        action = { topic: '/heartbeat', messageType: 'std_msgs/Bool', field: 'data' };
        break;
      default:
        action = { topic: `/${componentType}`, messageType: layout.rosConfig.defaultMessageType };
    }

    const defaultConfig =
      componentType === 'camera'
        ? { cameraTransport: 'proxy' as const }
        : componentType === 'plot'
          ? { fieldPath: 'data', fieldPaths: ['data'], timeWindowSec: 10, autoScale: true, minY: -1, maxY: 1 }
          : componentType === 'heartbeat'
            ? { heartbeatMode: 'boolean' as const, heartbeatTimeoutMs: 2000, heartbeatFieldPath: 'data' }
            : componentType === 'physical-gamepad'
              ? {
                physicalGamepadProfile: 'auto' as const,
                physicalGamepadDeadzone: 0.08,
                physicalGamepadPublishHz: DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ,
              }
              : componentType === 'dpad'
                ? { buttonMapping: { up: 0, right: 1, down: 2, left: 3 } }
                : componentType === 'joystick'
                  ? { min: -1, max: 1, sliderMin: -1, sliderMax: 1, axes: ['0', '1'] }
                  : undefined;

    const newComponent: GamepadComponentConfig = {
      id: `${componentType}-${Date.now()}`,
      type: componentType as any,
      position: { ...placement },
      label: componentDef.name,
      action: action,
      config: defaultConfig
    };

    setLayout(prev => ({
      ...prev,
      components: [...prev.components, newComponent]
    }));

    setEditorState(prev => ({
      ...prev,
      selectedComponentId: newComponent.id
    }));
  }, [layout.rosConfig]);

  const handleComponentSelect = useCallback((id: string) => {
    setEditorState(prev => {
      if (prev.selectedComponentId === id) {
        return { ...prev, selectedComponentId: null };
      } else {
        return { ...prev, selectedComponentId: id };
      }
    });
  }, []);

  const handleComponentUpdate = useCallback((id: string, config: GamepadComponentConfig) => {
    // Validate position to prevent components from going off-grid
    const validatedConfig = {
      ...config,
      position: {
        ...config.position,
        x: Math.max(0, Math.min(config.position.x, layout.gridSize.width - config.position.width)),
        y: Math.max(0, Math.min(config.position.y, layout.gridSize.height - config.position.height)),
        width: Math.max(1, Math.min(config.position.width, layout.gridSize.width - config.position.x)),
        height: Math.max(1, Math.min(config.position.height, layout.gridSize.height - config.position.y))
      }
    };
    
    setLayout(prev => ({
      ...prev,
      components: prev.components.map(c => c.id === id ? validatedConfig : c)
    }));
  }, [layout.gridSize]);

  const handleComponentDelete = useCallback((id: string) => {
    setLayout(prev => ({
      ...prev,
      components: prev.components.filter(c => c.id !== id)
    }));
    setEditorState(prev => ({
      ...prev,
      selectedComponentId: prev.selectedComponentId === id ? null : prev.selectedComponentId
    }));
  }, []);

  const handleOpenSettings = useCallback((id: string) => {
    const component = layout.components.find(c => c.id === id);
    if (component) {
      setSettingsComponent(component);
      setSettingsModalOpen(true);
    }
  }, [layout.components]);

  const handleCloseSettings = useCallback(() => {
    setSettingsModalOpen(false);
    setSettingsComponent(null);
  }, []);

  const handleSaveSettings = useCallback((config: GamepadComponentConfig) => {
    handleComponentUpdate(config.id, config);
    handleCloseSettings();
  }, [handleComponentUpdate, handleCloseSettings]);

  const handleSave = useCallback(() => {
    const updatedLayout = {
      ...layout,
      metadata: {
        ...layout.metadata,
        modified: new Date().toISOString()
      }
    };

    if (saveCustomGamepad(updatedLayout)) {
      onSave(updatedLayout);
      onClose();
    } else {
      alert('Failed to save gamepad layout');
    }
  }, [layout, onSave, onClose]);

  // Where a pointer is on the grid: in cell units, and as the top-left cell that centres an item of the given size
  // under it.
  const getGridPositionFromEvent = useCallback((
    clientX: number,
    clientY: number,
    itemWidth = 1,
    itemHeight = 1
  ) => {
    if (!designAreaRef.current) return null;
    const gridEl = designAreaRef.current.querySelector('.gamepad-grid') as HTMLElement ?? designAreaRef.current;

    const cells = measureGridCells(gridEl, layout.gridSize);
    let metrics = cells;
    if (!metrics) {
      // The first frame, before the background cells have layout.
      const gridRect = gridEl.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(gridEl);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
      const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const columnGap = parseFloat(computedStyle.columnGap) || 0;
      const rowGap = parseFloat(computedStyle.rowGap) || 0;
      const innerWidth = Math.max(1, gridRect.width - paddingLeft - paddingRight);
      const innerHeight = Math.max(1, gridRect.height - paddingTop - paddingBottom);
      const cellWidth = Math.max(1, (innerWidth - columnGap * (layout.gridSize.width - 1)) / layout.gridSize.width);
      const cellHeight = Math.max(1, (innerHeight - rowGap * (layout.gridSize.height - 1)) / layout.gridSize.height);
      metrics = {
        left: gridRect.left + paddingLeft,
        top: gridRect.top + paddingTop,
        cellWidth,
        cellHeight,
        columnStep: cellWidth + columnGap,
        rowStep: cellHeight + rowGap,
      };
    }

    const { left, top, cellWidth, cellHeight, columnStep, rowStep } = metrics;
    const previewWidth = cellWidth + (itemWidth - 1) * columnStep;
    const previewHeight = cellHeight + (itemHeight - 1) * rowStep;
    const point: GridPoint = { x: (clientX - left) / columnStep, y: (clientY - top) / rowStep };
    return {
      x: Math.round((clientX - left - previewWidth / 2) / columnStep),
      y: Math.round((clientY - top - previewHeight / 2) / rowStep),
      point,
      cellWidth,
      cellHeight,
    };
  }, [layout.gridSize]);

  // Inside the grid and clear of every other component.
  const isPositionValid = useCallback((x: number, y: number, width: number, height: number, excludeId?: string) =>
    isAreaFree(
      { x, y, width, height },
      layout.gridSize,
      layout.components.filter(c => c.id !== excludeId).map(c => c.position)
    ), [layout.gridSize, layout.components]);

  /**
   * Where a drag or a tap would put a component. A new one takes the largest room there is under the pointer, up to
   * its default size, so it never lands outside the grid or over another component; a moved one keeps its size.
   */
  const placementFor = useCallback((
    clientX: number,
    clientY: number,
    dragState: NonNullable<EditorState['dragState']>
  ): EditorState['dropPreview'] => {
    const preferred = dragState.defaultSize || { width: 1, height: 1 };
    const pos = getGridPositionFromEvent(clientX, clientY, preferred.width, preferred.height);
    if (!pos) return null;

    if (dragState.source === 'palette') {
      const fitted = fitNewComponent(preferred, layout.gridSize, layout.components.map(c => c.position), pos.point);
      if (fitted) {
        return { ...fitted, isValid: true, isFitted: fitted.width !== preferred.width || fitted.height !== preferred.height };
      }
    }

    const width = Math.min(preferred.width, layout.gridSize.width);
    const height = Math.min(preferred.height, layout.gridSize.height);
    const x = Math.max(0, Math.min(pos.x, layout.gridSize.width - width));
    const y = Math.max(0, Math.min(pos.y, layout.gridSize.height - height));
    return {
      x,
      y,
      width,
      height,
      isValid: dragState.source === 'grid' && width === preferred.width && height === preferred.height
        && isPositionValid(x, y, width, height, dragState.componentId),
    };
  }, [getGridPositionFromEvent, isPositionValid, layout.gridSize, layout.components]);

  /** Carries out a placement: adds the new component, or moves the dragged one. */
  const commitPlacement = useCallback((dragState: NonNullable<EditorState['dragState']>, placement: EditorState['dropPreview']) => {
    if (!placement?.isValid) return;
    const rect = { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
    if (dragState.source === 'palette' && dragState.componentType) {
      handleAddComponent(dragState.componentType, rect);
    } else if (dragState.source === 'grid' && dragState.componentId) {
      const component = layout.components.find(c => c.id === dragState.componentId);
      if (component) handleComponentUpdate(dragState.componentId, { ...component, position: { ...component.position, x: rect.x, y: rect.y } });
    }
  }, [handleAddComponent, handleComponentUpdate, layout.components]);

  // A component picked in the gallery is placed by tapping the grid; a tap on the empty grid otherwise just clears
  // the selection.
  const handleGridClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const pending = editorState.draggedComponent;
    if (!pending) {
      setEditorState(prev => (prev.selectedComponentId ? { ...prev, selectedComponentId: null } : prev));
      return;
    }
    const dragState = { isDragging: false, source: 'palette' as const, componentType: pending.componentType, defaultSize: pending.defaultSize };
    commitPlacement(dragState, placementFor(event.clientX, event.clientY, dragState));
    setEditorState(prev => ({ ...prev, draggedComponent: null }));
  }, [editorState.draggedComponent, placementFor, commitPlacement]);

  // Drag start from palette
  const handlePaletteDragStart = useCallback((componentType: string) => {
    const componentDef = componentLibrary.find(c => c.type === componentType);
    if (!componentDef) return;
    
    const newDragState = {
      isDragging: true,
      source: 'palette' as const,
      componentType: componentType as GamepadComponentConfig['type'],
      defaultSize: componentDef.defaultSize
    };
    
    // Set ref immediately for synchronous access during drag events
    dragStateRef.current = newDragState;
    
    // Placing a new component puts the selected one's tools away, so they do not cover the drop preview.
    setEditorState(prev => ({
      ...prev,
      selectedComponentId: null,
      dragState: newDragState,
      draggedComponent: {
        componentType: componentType as GamepadComponentConfig['type'],
        defaultSize: componentDef.defaultSize
      }
    }));
  }, []);

  // Drag start from existing component in grid
  const handleComponentDragStart = useCallback((componentId: string) => {
    const component = layout.components.find(c => c.id === componentId);
    if (!component) return;
    
    const newDragState = {
      isDragging: true,
      source: 'grid' as const,
      componentId,
      componentType: component.type,
      defaultSize: { width: component.position.width, height: component.position.height },
      startPosition: { x: component.position.x, y: component.position.y }
    };
    
    // Set ref immediately for synchronous access during drag events
    dragStateRef.current = newDragState;
    
    setEditorState(prev => ({
      ...prev,
      selectedComponentId: componentId,
      dragState: newDragState
    }));
  }, [layout.components]);

  // Update drop preview from position
  const updateDropPreview = useCallback((clientX: number, clientY: number, dragState: EditorState['dragState']) => {
    if (!dragState) return;
    const dropPreview = placementFor(clientX, clientY, dragState);
    if (dropPreview) setEditorState(prev => ({ ...prev, dropPreview }));
  }, [placementFor]);

  // Handle drag over the design area
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    
    // Use ref for immediate access (React state updates are async)
    const dragState = dragStateRef.current || editorState.dragState;
    
    if (!dragState) return;
    
    updateDropPreview(event.clientX, event.clientY, dragState);
  }, [editorState.dragState, updateDropPreview]);

  // Handle drop on the design area
  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Use ref for immediate access, fallback to state
    let dragState = dragStateRef.current || editorState.dragState;
    
    // If still no drag state, try to reconstruct from dataTransfer (only works on drop, not dragover)
    if (!dragState) {
      const data = event.dataTransfer.getData('text/plain');
      if (data) {
        // Check if it's a component type (from palette)
        const componentDef = componentLibrary.find(c => c.type === data);
        if (componentDef) {
          dragState = {
            isDragging: true,
            source: 'palette',
            componentType: data as GamepadComponentConfig['type'],
            defaultSize: componentDef.defaultSize
          };
        } else {
          // Check if it's a component ID (from grid)
          const existingComponent = layout.components.find(c => c.id === data);
          if (existingComponent) {
            dragState = {
              isDragging: true,
              source: 'grid',
              componentId: data,
              componentType: existingComponent.type,
              defaultSize: { width: existingComponent.position.width, height: existingComponent.position.height },
              startPosition: { x: existingComponent.position.x, y: existingComponent.position.y }
            };
          }
        }
      }
    }
    
    // Placed fresh from the drop's own coordinates (the preview state may be a frame behind).
    if (dragState) commitPlacement(dragState, placementFor(event.clientX, event.clientY, dragState));
    
    // Clear drag state (both ref and state)
    dragStateRef.current = null;
    setEditorState(prev => ({
      ...prev,
      dragState: null,
      dropPreview: null,
      draggedComponent: null
    }));
  }, [editorState.dragState, layout.components, placementFor, commitPlacement]);

  // Handle drag end (cancel)
  const handleDragEnd = useCallback(() => {
    dragStateRef.current = null;
    setEditorState(prev => ({
      ...prev,
      dragState: null,
      dropPreview: null,
      draggedComponent: null
    }));
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setEditorState(prev => ({
        ...prev,
        dropPreview: null
      }));
    }
  }, []);

  // ============= GLOBAL TOUCH EVENTS FOR MOBILE =============
  
  // Global touch move handler - works even when touch started outside design area
  useEffect(() => {
    if (!isOpen) return;
    
    const handleGlobalTouchMove = (e: TouchEvent) => {
      // Use ref for immediate access
      const dragState = dragStateRef.current || editorState.dragState;
      if (!dragState) return;
      
      e.preventDefault();
      const touch = e.touches[0];
      updateDropPreview(touch.clientX, touch.clientY, dragState);
    };
    
    const handleGlobalTouchEnd = (e: TouchEvent) => {
      // Use ref for immediate access
      const dragState = dragStateRef.current || editorState.dragState;
      const dropPreview = editorState.dropPreview;
      
      if (!dragState) return;
      
      e.preventDefault();
      
      // The preview is where the finger left it.
      commitPlacement(dragState, dropPreview);
      
      // Clear both ref and state
      dragStateRef.current = null;
      setEditorState(prev => ({
        ...prev,
        dragState: null,
        dropPreview: null,
        draggedComponent: null
      }));
    };
    
    // Only add listeners when dragging (check both ref and state)
    const isDragging = dragStateRef.current || editorState.dragState;
    if (isDragging) {
      document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
      document.addEventListener('touchend', handleGlobalTouchEnd, { passive: false });
      
      return () => {
        document.removeEventListener('touchmove', handleGlobalTouchMove);
        document.removeEventListener('touchend', handleGlobalTouchEnd);
      };
    }
  }, [isOpen, editorState.dragState, editorState.dropPreview, updateDropPreview, commitPlacement]);

  if (!isOpen) return null;

  return (
    <div className="gamepad-editor-overlay">
      <div className="gamepad-editor-modal" ref={modalRef}>
        <div className="editor-header">
          <div className="editor-title">
            <span className="editor-kicker">Pad designer</span>
            <h2>Gamepad Editor</h2>
          </div>
          <div className="editor-header-actions">
            <button
              type="button"
              className={`editor-header-action ${activeToolPanel === 'components' ? 'is-active' : ''}`}
              onClick={() => setActiveToolPanel(current => current === 'components' ? null : 'components')}
              aria-pressed={activeToolPanel === 'components'}
              aria-label="Components"
            >
              <FiGrid aria-hidden="true" />
              <span>Components</span>
            </button>
            <button
              type="button"
              className={`editor-header-action ${activeToolPanel === 'layout' ? 'is-active' : ''}`}
              onClick={() => setActiveToolPanel(current => current === 'layout' ? null : 'layout')}
              aria-pressed={activeToolPanel === 'layout'}
              aria-label="Layout settings"
            >
              <FiSliders aria-hidden="true" />
              <span>Layout</span>
            </button>
            <button type="button" className="editor-close-button" onClick={onClose} aria-label="Close gamepad editor">
              <FiX aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="editor-content">
          <div className={`editor-workspace ${activeToolPanel ? 'has-tools-panel' : ''}`}>
            {activeToolPanel && (
              <aside className="editor-tools-panel" aria-label={activeToolPanel === 'components' ? 'Components' : 'Layout settings'}>
                <header className="editor-tools-header">
                  <div>
                    <span className="editor-kicker">Editor tools</span>
                    <h3>{activeToolPanel === 'components' ? 'Components' : 'Layout settings'}</h3>
                  </div>
                  <button type="button" onClick={() => setActiveToolPanel(null)} aria-label="Close editor tools">
                    <FiX aria-hidden="true" />
                  </button>
                </header>
                <div className="editor-tools-scroll">
                  {activeToolPanel === 'components' ? (
                    <ComponentPalette
                      contentOnly
                      selectedComponent={editorState.draggedComponent?.componentType || null}
                      onComponentSelect={(componentType) => setEditorState(prev => ({
                        ...prev,
                        draggedComponent: {
                          componentType: componentType as GamepadComponentConfig['type'],
                          defaultSize: componentLibrary.find(c => c.type === componentType)?.defaultSize || { width: 1, height: 1 }
                        }
                      }))}
                      onDragStart={handlePaletteDragStart}
                      onDragEnd={handleDragEnd}
                    />
                  ) : (
                    <GridSettingsMenu
                      contentOnly
                      layoutName={layout.name}
                      layoutDescription={layout.description || ''}
                      gridWidth={layout.gridSize.width}
                      gridHeight={layout.gridSize.height}
                      minGridWidth={contentExtent.width}
                      minGridHeight={contentExtent.height}
                      onNameChange={handleLayoutNameChange}
                      onDescriptionChange={handleLayoutDescriptionChange}
                      onGridSizeChange={handleGridSizeChange}
                    />
                  )}
                </div>
              </aside>
            )}

            <div 
              ref={designAreaRef}
              className={`design-area ${editorState.dragState?.isDragging ? 'drag-active' : ''}`}
              onClick={handleGridClick}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragLeave={handleDragLeave}
            >
              <LayoutRenderer
                layout={layout}
                ros={ros}
                isEditing={true}
                selectedComponentId={editorState.selectedComponentId}
                dropPreview={editorState.dropPreview}
                dragState={editorState.dragState}
                onComponentSelect={handleComponentSelect}
                onComponentUpdate={handleComponentUpdate}
                onComponentDelete={handleComponentDelete}
                onOpenSettings={handleOpenSettings}
                onComponentDragStart={handleComponentDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            </div>
          </div>
        </div>

        <div className="editor-footer">
          <div className="pad-name-section">
            <label htmlFor="pad-name-input">Gamepad Name:</label>
            <input
              id="pad-name-input"
              type="text"
              className="pad-name-input"
              value={layout.name}
              onChange={(e) => handleLayoutNameChange(e.target.value)}
              placeholder="Enter gamepad name..."
            />
          </div>
          <div className="footer-buttons">
            <button className="cancel-button" onClick={onClose}>
              Cancel
            </button>
            <button className="save-button" onClick={handleSave}>
              Save Gamepad
            </button>
          </div>
        </div>
      </div>
      
      {/* Component Settings Modal */}
      <ComponentSettingsModal
        isOpen={settingsModalOpen}
        component={settingsComponent}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        ros={ros}
      />
    </div>
  );
};

export default GamepadEditor;
