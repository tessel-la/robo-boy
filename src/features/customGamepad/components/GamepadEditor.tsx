import React, { useState, useCallback } from 'react';
import type { Ros } from 'roslib';
import { 
  CustomGamepadLayout, 
  GamepadComponentConfig, 
  EditorState,
  DragItem,
  ComponentInteractionMode
} from '../types';
import { componentLibrary } from '../defaultLayouts';
import { generateGamepadId, saveCustomGamepad } from '../gamepadStorage';
import LayoutRenderer from './CustomGamepadLayout';
import ComponentPalette from './ComponentPalette';
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
    gridSize: layout.gridSize,
    cellSize: layout.cellSize,
    showGrid: true,
    snapToGrid: true
  });

  const [activeTab, setActiveTab] = useState<'design' | 'settings'>('design');
  
  // Settings modal state
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsComponent, setSettingsComponent] = useState<GamepadComponentConfig | null>(null);

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

  const handleCellSizeChange = useCallback((cellSize: number) => {
    setLayout(prev => ({ ...prev, cellSize }));
    setEditorState(prev => ({ ...prev, cellSize }));
  }, []);

  const handleAddComponent = useCallback((componentType: string, x: number, y: number) => {
    const componentDef = componentLibrary.find(c => c.type === componentType);
    if (!componentDef) return;

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
      action: {
        topic: layout.rosConfig.defaultTopic,
        messageType: layout.rosConfig.defaultMessageType
      }
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
            nextMode = ComponentInteractionMode.Settings;
            break;
          case ComponentInteractionMode.Settings:
            // Cycle back to translate or deselect
            nextMode = ComponentInteractionMode.None;
            return {
              ...prev,
              selectedComponentId: null,
              componentInteractionMode: ComponentInteractionMode.None
            };
          default:
            nextMode = ComponentInteractionMode.Translate;
        }
        
        // Open settings modal if we're in settings mode
        if (nextMode === ComponentInteractionMode.Settings) {
          const component = layout.components.find(c => c.id === id);
          if (component) {
            setSettingsComponent(component);
            setSettingsModalOpen(true);
          }
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

  if (!isOpen) return null;

  const selectedComponent = layout.components.find(c => c.id === editorState.selectedComponentId);

  return (
    <div className="gamepad-editor-overlay">
      <div className="gamepad-editor-modal">
        <div className="editor-header">
          <h2>Gamepad Editor</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="editor-tabs">
          <button 
            className={`tab ${activeTab === 'design' ? 'active' : ''}`}
            onClick={() => setActiveTab('design')}
          >
            Design
          </button>
          <button 
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>

        <div className="editor-content">
          {activeTab === 'design' && (
            <div className="design-tab">
              <ComponentPalette
                selectedComponent={editorState.draggedComponent?.componentType || null}
                onComponentSelect={(componentType) => setEditorState(prev => ({
                  ...prev,
                  draggedComponent: {
                    componentType,
                    defaultSize: componentLibrary.find(c => c.type === componentType)?.defaultSize || { width: 1, height: 1 }
                  }
                }))}
              />

              <div className="design-area" onClick={handleGridClick}>
                <LayoutRenderer
                  layout={layout}
                  ros={ros}
                  isEditing={true}
                  selectedComponentId={editorState.selectedComponentId}
                  interactionMode={editorState.componentInteractionMode}
                  onComponentSelect={handleComponentSelect}
                  onComponentUpdate={handleComponentUpdate}
                  onComponentDelete={handleComponentDelete}
                  onOpenSettings={handleOpenSettings}
                />
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="settings-tab">
              <div className="settings-group">
                <label>Name:</label>
                <input
                  type="text"
                  value={layout.name}
                  onChange={(e) => handleLayoutNameChange(e.target.value)}
                />
              </div>
              <div className="settings-group">
                <label>Description:</label>
                <textarea
                  value={layout.description}
                  onChange={(e) => handleLayoutDescriptionChange(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="settings-group">
                <label>Grid Columns:</label>
                <input
                  type="number"
                  min="4"
                  max="12"
                  value={layout.gridSize.width}
                  onChange={(e) => handleGridSizeChange(parseInt(e.target.value), layout.gridSize.height)}
                />
                <small>Number of columns for component placement (logical division only)</small>
              </div>
              <div className="settings-group">
                <label>Grid Rows:</label>
                <input
                  type="number"
                  min="3"
                  max="10"
                  value={layout.gridSize.height}
                  onChange={(e) => handleGridSizeChange(layout.gridSize.width, parseInt(e.target.value))}
                />
                <small>Number of rows for component placement (logical division only)</small>
              </div>

            </div>
          )}


        </div>

        <div className="editor-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button className="save-button" onClick={handleSave}>
            Save Gamepad
          </button>
        </div>
      </div>
      
      {/* Component Settings Modal */}
      <ComponentSettingsModal
        isOpen={settingsModalOpen}
        component={settingsComponent}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
      />
    </div>
  );
};

export default GamepadEditor; 