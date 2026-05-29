import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Ros } from 'roslib';
import { 
  CustomGamepadLayout, 
  GamepadComponentConfig, 
  EditorState
} from '../types';
import { componentLibrary } from '../defaultLayouts';
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

  // Track expanded state of sidebar components
  const [componentPaletteExpanded, setComponentPaletteExpanded] = useState(false);
  const [gridSettingsExpanded, setGridSettingsExpanded] = useState(false);

  // Handle component palette expansion with mutual exclusion
  const handleComponentPaletteExpandedChange = useCallback((expanded: boolean) => {
    setComponentPaletteExpanded(expanded);
    if (expanded) {
      setGridSettingsExpanded(false);
    }
  }, []);

  // Handle grid settings expansion with mutual exclusion
  const handleGridSettingsExpandedChange = useCallback((expanded: boolean) => {
    setGridSettingsExpanded(expanded);
    if (expanded) {
      setComponentPaletteExpanded(false);
    }
  }, []);

  const handleLayoutNameChange = useCallback((name: string) => {
    setLayout(prev => ({ ...prev, name }));
  }, []);

  const handleLayoutDescriptionChange = useCallback((description: string) => {
    setLayout(prev => ({ ...prev, description }));
  }, []);

  const handleGridSizeChange = useCallback((width: number, height: number) => {
    setLayout(prev => ({
      ...prev,
      gridSize: { width, height }
    }));
    setEditorState(prev => ({
      ...prev,
      gridSize: { width, height }
    }));
  }, []);

  const handleAddComponent = useCallback((componentType: string, x: number, y: number) => {
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
      default:
        action = { topic: `/${componentType}`, messageType: layout.rosConfig.defaultMessageType };
    }

    const newComponent: GamepadComponentConfig = {
      id: `${componentType}-${Date.now()}`,
      type: componentType as any,
      position: {
        x,
        y,
        width: componentDef.defaultSize.width,
        height: componentDef.defaultSize.height
      },
      label: componentDef.name,
      action: action
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

  const handleGridClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editorState.draggedComponent) return;

    const gridRect = event.currentTarget.getBoundingClientRect();
    const cellWidth = (gridRect.width - 32) / layout.gridSize.width;
    const cellHeight = (gridRect.height - 32) / layout.gridSize.height;
    
    const x = Math.floor((event.clientX - gridRect.left - 16) / cellWidth);
    const y = Math.floor((event.clientY - gridRect.top - 16) / cellHeight);

    if (x >= 0 && x < layout.gridSize.width && y >= 0 && y < layout.gridSize.height) {
      handleAddComponent(editorState.draggedComponent.componentType, x, y);
    }

    setEditorState(prev => ({ ...prev, draggedComponent: null }));
  }, [editorState.draggedComponent, layout.gridSize, handleAddComponent]);

  // Calculate grid position from mouse/touch event
  const getGridPositionFromEvent = useCallback((clientX: number, clientY: number) => {
    if (!designAreaRef.current) return null;
    
    // Try to find the grid element
    let gridEl = designAreaRef.current.querySelector('.gamepad-grid') as HTMLElement;
    
    // Fallback: use the design area itself
    if (!gridEl) {
      gridEl = designAreaRef.current;
    }
    
    const gridRect = gridEl.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(gridEl);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 8;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 8;
    
    const innerWidth = Math.max(100, gridRect.width - paddingLeft * 2);
    const innerHeight = Math.max(100, gridRect.height - paddingTop * 2);
    
    const cellWidth = innerWidth / layout.gridSize.width;
    const cellHeight = innerHeight / layout.gridSize.height;
    
    // Calculate position relative to grid, clamping to valid range
    const relX = clientX - gridRect.left - paddingLeft;
    const relY = clientY - gridRect.top - paddingTop;
    
    const x = Math.max(0, Math.min(Math.floor(relX / cellWidth), layout.gridSize.width - 1));
    const y = Math.max(0, Math.min(Math.floor(relY / cellHeight), layout.gridSize.height - 1));
    
    return { x, y, cellWidth, cellHeight };
  }, [layout.gridSize]);

  // Check if a position is valid for placement (no overlaps)
  const isPositionValid = useCallback((x: number, y: number, width: number, height: number, excludeId?: string) => {
    if (x < 0 || y < 0 || x + width > layout.gridSize.width || y + height > layout.gridSize.height) {
      return false;
    }
    
    for (const comp of layout.components) {
      if (excludeId && comp.id === excludeId) continue;
      
      const overlapsX = x < comp.position.x + comp.position.width && x + width > comp.position.x;
      const overlapsY = y < comp.position.y + comp.position.height && y + height > comp.position.y;
      
      if (overlapsX && overlapsY) {
        return false;
      }
    }
    
    return true;
  }, [layout.gridSize, layout.components]);

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
    
    setEditorState(prev => ({
      ...prev,
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
    
    const pos = getGridPositionFromEvent(clientX, clientY);
    if (!pos) return;
    
    const width = dragState.defaultSize?.width || 1;
    const height = dragState.defaultSize?.height || 1;
    
    const clampedX = Math.max(0, Math.min(pos.x, layout.gridSize.width - width));
    const clampedY = Math.max(0, Math.min(pos.y, layout.gridSize.height - height));
    
    const isValid = isPositionValid(clampedX, clampedY, width, height, dragState.componentId);
    
    setEditorState(prev => ({
      ...prev,
      dropPreview: {
        x: clampedX,
        y: clampedY,
        width,
        height,
        isValid
      }
    }));
  }, [getGridPositionFromEvent, isPositionValid, layout.gridSize]);

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
    
    // Calculate drop position fresh from event coordinates (don't rely on stale preview state)
    if (dragState) {
      const pos = getGridPositionFromEvent(event.clientX, event.clientY);
      const width = dragState.defaultSize?.width || 1;
      const height = dragState.defaultSize?.height || 1;
      
      // Use calculated position or fallback to (0,0)
      let dropX = pos ? pos.x : 0;
      let dropY = pos ? pos.y : 0;
      
      // Clamp to valid range
      dropX = Math.max(0, Math.min(dropX, layout.gridSize.width - width));
      dropY = Math.max(0, Math.min(dropY, layout.gridSize.height - height));
      
      // Check if position is valid (no overlaps)
      const isValid = isPositionValid(dropX, dropY, width, height, dragState.componentId);
      
      // Perform the drop action if valid
      if (isValid) {
        if (dragState.source === 'palette' && dragState.componentType) {
          handleAddComponent(dragState.componentType, dropX, dropY);
        } else if (dragState.source === 'grid' && dragState.componentId) {
          const component = layout.components.find(c => c.id === dragState.componentId);
          if (component) {
            handleComponentUpdate(dragState.componentId, {
              ...component,
              position: {
                ...component.position,
                x: dropX,
                y: dropY
              }
            });
          }
        }
      }
    }
    
    // Clear drag state (both ref and state)
    dragStateRef.current = null;
    setEditorState(prev => ({
      ...prev,
      dragState: null,
      dropPreview: null,
      draggedComponent: null
    }));
  }, [editorState.dragState, handleAddComponent, handleComponentUpdate, layout.components, getGridPositionFromEvent, layout.gridSize, isPositionValid]);

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
      
      // If we have a valid drop position, add/move the component
      if (dropPreview && dropPreview.isValid) {
        if (dragState.source === 'palette' && dragState.componentType) {
          handleAddComponent(dragState.componentType, dropPreview.x, dropPreview.y);
        } else if (dragState.source === 'grid' && dragState.componentId) {
          const component = layout.components.find(c => c.id === dragState.componentId);
          if (component) {
            handleComponentUpdate(dragState.componentId, {
              ...component,
              position: {
                ...component.position,
                x: dropPreview.x,
                y: dropPreview.y
              }
            });
          }
        }
      }
      
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
  }, [isOpen, editorState.dragState, editorState.dropPreview, updateDropPreview, handleAddComponent, handleComponentUpdate, layout.components]);

  if (!isOpen) return null;

  return (
    <div className="gamepad-editor-overlay">
      <div className="gamepad-editor-modal" ref={modalRef}>
        <div className="editor-header">
          <h2>Gamepad Editor</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="editor-content">
          <div className="design-tab">
            <div className={`editor-sidebar ${componentPaletteExpanded ? 'component-palette-expanded' : ''} ${gridSettingsExpanded ? 'grid-settings-expanded' : ''}`}>
              
              {/* Buttons row - always visible at the top */}
              <div className="sidebar-buttons-row">
                <ComponentPalette
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
                  onExpandedChange={handleComponentPaletteExpandedChange}
                  forceCollapsed={gridSettingsExpanded}
                />

                <GridSettingsMenu
                  layoutName={layout.name}
                  layoutDescription={layout.description || ''}
                  gridWidth={layout.gridSize.width}
                  gridHeight={layout.gridSize.height}
                  onNameChange={handleLayoutNameChange}
                  onDescriptionChange={handleLayoutDescriptionChange}
                  onGridSizeChange={handleGridSizeChange}
                  onExpandedChange={handleGridSettingsExpandedChange}
                  forceCollapsed={componentPaletteExpanded}
                />
              </div>

              {/* Expanded content area - full width when expanded */}
              <div className="sidebar-expanded-content">
                {componentPaletteExpanded && (
                  <ComponentPalette
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
                    onExpandedChange={handleComponentPaletteExpandedChange}
                    forceCollapsed={gridSettingsExpanded}
                  />
                )}

                {gridSettingsExpanded && (
                  <GridSettingsMenu
                    layoutName={layout.name}
                    layoutDescription={layout.description || ''}
                    gridWidth={layout.gridSize.width}
                    gridHeight={layout.gridSize.height}
                    onNameChange={handleLayoutNameChange}
                    onDescriptionChange={handleLayoutDescriptionChange}
                    onGridSizeChange={handleGridSizeChange}
                    onExpandedChange={handleGridSettingsExpandedChange}
                    forceCollapsed={componentPaletteExpanded}
                  />
                )}
              </div>
            </div>

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
