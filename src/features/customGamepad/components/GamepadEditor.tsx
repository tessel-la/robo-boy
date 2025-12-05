import React, { useState, useCallback, useRef } from 'react';
import type { Ros } from 'roslib';
import { 
  CustomGamepadLayout, 
  GamepadComponentConfig, 
  EditorState,
  ComponentInteractionMode
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
    componentInteractionMode: ComponentInteractionMode.None,
    draggedComponent: null,
    dragState: null,
    dropPreview: null,
    gridSize: layout.gridSize,
    cellSize: layout.cellSize,
    showGrid: true,
    snapToGrid: true
  });

  const designAreaRef = useRef<HTMLDivElement>(null);

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
      setGridSettingsExpanded(false); // Collapse the other component
    }
  }, []);

  // Handle grid settings expansion with mutual exclusion
  const handleGridSettingsExpandedChange = useCallback((expanded: boolean) => {
    setGridSettingsExpanded(expanded);
    if (expanded) {
      setComponentPaletteExpanded(false); // Collapse the other component
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

    // Set default topic and message type based on component type
    let action: { topic: string; messageType: string; field?: string } = {
      topic: `/${componentType}`,
      messageType: 'sensor_msgs/Joy', // Default fallback
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
      // If clicking the same component, cycle through interaction modes
      if (prev.selectedComponentId === id) {
        let nextMode: ComponentInteractionMode;
        switch (prev.componentInteractionMode) {
          case ComponentInteractionMode.None:
            nextMode = ComponentInteractionMode.Translate;
            break;
          case ComponentInteractionMode.Translate:
            nextMode = ComponentInteractionMode.Resize;
            break;
          case ComponentInteractionMode.Resize:
            // Cycle back to None instead of Settings
            nextMode = ComponentInteractionMode.None;
            return {
              ...prev,
              selectedComponentId: null,
              componentInteractionMode: ComponentInteractionMode.None
            };
          default:
            nextMode = ComponentInteractionMode.Translate;
        }
        
        return {
          ...prev,
          componentInteractionMode: nextMode
        };
      } else {
        // Selecting a different component, start with translate mode
        return {
          ...prev,
          selectedComponentId: id,
          componentInteractionMode: ComponentInteractionMode.Translate
        };
      }
    });
  }, [layout.components]);

  const handleComponentUpdate = useCallback((id: string, config: GamepadComponentConfig) => {
    setLayout(prev => ({
      ...prev,
      components: prev.components.map(c => c.id === id ? config : c)
    }));
  }, []);

  const handleComponentDelete = useCallback((id: string) => {
    setLayout(prev => ({
      ...prev,
      components: prev.components.filter(c => c.id !== id)
    }));
    setEditorState(prev => ({
      ...prev,
      selectedComponentId: prev.selectedComponentId === id ? null : prev.selectedComponentId,
      componentInteractionMode: prev.selectedComponentId === id ? ComponentInteractionMode.None : prev.componentInteractionMode
    }));
  }, []);

  const handleOpenSettings = useCallback((id: string) => {
    const component = layout.components.find(c => c.id === id);
    if (component) {
      setSettingsComponent(component);
      setSettingsModalOpen(true);
      setEditorState(prev => ({
        ...prev,
        componentInteractionMode: ComponentInteractionMode.Settings
      }));
    }
  }, [layout.components]);

  const handleCloseSettings = useCallback(() => {
    setSettingsModalOpen(false);
    setSettingsComponent(null);
    setEditorState(prev => ({
      ...prev,
      componentInteractionMode: ComponentInteractionMode.None
    }));
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
    // Calculate grid cell size based on actual container dimensions
    const cellWidth = (gridRect.width - 32) / layout.gridSize.width; // 32px for padding (16px each side)
    const cellHeight = (gridRect.height - 32) / layout.gridSize.height; // 32px for padding (16px each side)
    
    const x = Math.floor((event.clientX - gridRect.left - 16) / cellWidth); // 16px for left padding
    const y = Math.floor((event.clientY - gridRect.top - 16) / cellHeight); // 16px for top padding

    if (x >= 0 && x < layout.gridSize.width && y >= 0 && y < layout.gridSize.height) {
      handleAddComponent(editorState.draggedComponent.componentType, x, y);
    }

    setEditorState(prev => ({ ...prev, draggedComponent: null }));
  }, [editorState.draggedComponent, layout.gridSize, handleAddComponent]);

  // Calculate grid position from mouse/touch event
  const getGridPositionFromEvent = useCallback((clientX: number, clientY: number) => {
    if (!designAreaRef.current) return null;
    
    const layoutEl = designAreaRef.current.querySelector('.custom-gamepad-layout');
    if (!layoutEl) return null;
    
    const gridEl = layoutEl.querySelector('.gamepad-grid') as HTMLElement;
    if (!gridEl) return null;
    
    const gridRect = gridEl.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(gridEl);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 8;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 8;
    
    const innerWidth = gridRect.width - paddingLeft * 2;
    const innerHeight = gridRect.height - paddingTop * 2;
    
    const cellWidth = innerWidth / layout.gridSize.width;
    const cellHeight = innerHeight / layout.gridSize.height;
    
    const x = Math.floor((clientX - gridRect.left - paddingLeft) / cellWidth);
    const y = Math.floor((clientY - gridRect.top - paddingTop) / cellHeight);
    
    return { x, y, cellWidth, cellHeight };
  }, [layout.gridSize]);

  // Check if a position is valid for placement (no overlaps)
  const isPositionValid = useCallback((x: number, y: number, width: number, height: number, excludeId?: string) => {
    // Check bounds
    if (x < 0 || y < 0 || x + width > layout.gridSize.width || y + height > layout.gridSize.height) {
      return false;
    }
    
    // Check overlaps with existing components
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
    
    setEditorState(prev => ({
      ...prev,
      dragState: {
        isDragging: true,
        source: 'palette',
        componentType: componentType as GamepadComponentConfig['type'],
        defaultSize: componentDef.defaultSize
      },
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
    
    setEditorState(prev => ({
      ...prev,
      selectedComponentId: componentId,
      dragState: {
        isDragging: true,
        source: 'grid',
        componentId,
        componentType: component.type,
        defaultSize: { width: component.position.width, height: component.position.height },
        startPosition: { x: component.position.x, y: component.position.y }
      }
    }));
  }, [layout.components]);

  // Handle drag over the design area
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    
    const dragState = editorState.dragState;
    if (!dragState) return;
    
    const pos = getGridPositionFromEvent(event.clientX, event.clientY);
    if (!pos) return;
    
    const width = dragState.defaultSize?.width || 1;
    const height = dragState.defaultSize?.height || 1;
    
    // Clamp position to grid bounds
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
  }, [editorState.dragState, getGridPositionFromEvent, isPositionValid, layout.gridSize]);

  // Handle drop on the design area
  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    
    const dragState = editorState.dragState;
    const dropPreview = editorState.dropPreview;
    
    if (!dragState || !dropPreview || !dropPreview.isValid) {
      setEditorState(prev => ({
        ...prev,
        dragState: null,
        dropPreview: null,
        draggedComponent: null
      }));
      return;
    }
    
    if (dragState.source === 'palette' && dragState.componentType) {
      // Add new component from palette
      handleAddComponent(dragState.componentType, dropPreview.x, dropPreview.y);
    } else if (dragState.source === 'grid' && dragState.componentId) {
      // Move existing component
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
    
    setEditorState(prev => ({
      ...prev,
      dragState: null,
      dropPreview: null,
      draggedComponent: null
    }));
  }, [editorState.dragState, editorState.dropPreview, handleAddComponent, handleComponentUpdate, layout.components]);

  // Handle drag end (cancel)
  const handleDragEnd = useCallback(() => {
    setEditorState(prev => ({
      ...prev,
      dragState: null,
      dropPreview: null,
      draggedComponent: null
    }));
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Only clear preview if leaving the design area entirely
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

  // ============= TOUCH EVENTS FOR MOBILE =============
  
  // Touch move handler for updating drop preview
  const handleTouchMove = useCallback((clientX: number, clientY: number) => {
    const dragState = editorState.dragState;
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
  }, [editorState.dragState, getGridPositionFromEvent, isPositionValid, layout.gridSize]);

  // Touch end handler for completing the drop
  const handleTouchEnd = useCallback(() => {
    const dragState = editorState.dragState;
    const dropPreview = editorState.dropPreview;
    
    if (!dragState || !dropPreview || !dropPreview.isValid) {
      setEditorState(prev => ({
        ...prev,
        dragState: null,
        dropPreview: null,
        draggedComponent: null
      }));
      return;
    }
    
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
    
    setEditorState(prev => ({
      ...prev,
      dragState: null,
      dropPreview: null,
      draggedComponent: null
    }));
  }, [editorState.dragState, editorState.dropPreview, handleAddComponent, handleComponentUpdate, layout.components]);

  // Design area touch handlers
  const handleDesignAreaTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!editorState.dragState) return;
    e.preventDefault();
    const touch = e.touches[0];
    handleTouchMove(touch.clientX, touch.clientY);
  }, [editorState.dragState, handleTouchMove]);

  const handleDesignAreaTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!editorState.dragState) return;
    e.preventDefault();
    handleTouchEnd();
  }, [editorState.dragState, handleTouchEnd]);

  if (!isOpen) return null;

  return (
    <div className="gamepad-editor-overlay">
      <div className="gamepad-editor-modal">
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
              onTouchMove={handleDesignAreaTouchMove}
              onTouchEnd={handleDesignAreaTouchEnd}
            >
              <LayoutRenderer
                layout={layout}
                ros={ros}
                isEditing={true}
                selectedComponentId={editorState.selectedComponentId}
                interactionMode={editorState.componentInteractionMode}
                dropPreview={editorState.dropPreview}
                dragState={editorState.dragState}
                onComponentSelect={handleComponentSelect}
                onComponentUpdate={handleComponentUpdate}
                onComponentDelete={handleComponentDelete}
                onOpenSettings={handleOpenSettings}
                onComponentDragStart={handleComponentDragStart}
                onDragEnd={handleDragEnd}
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