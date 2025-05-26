import React, { useState, useCallback } from 'react';
import type { Ros } from 'roslib';
import { 
  CustomGamepadLayout, 
  GamepadComponentConfig, 
  EditorState,
  DragItem 
} from '../types';
import { componentLibrary } from '../defaultLayouts';
import { generateGamepadId, saveCustomGamepad } from '../gamepadStorage';
import LayoutRenderer from './CustomGamepadLayout';
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
      gridSize: { width: 12, height: 8 },
      cellSize: 60,
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
    gridSize: layout.gridSize,
    cellSize: layout.cellSize,
    showGrid: true,
    snapToGrid: true
  });

  const [activeTab, setActiveTab] = useState<'design' | 'settings' | 'preview'>('design');

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
    setEditorState(prev => ({
      ...prev,
      selectedComponentId: id
    }));
  }, []);

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
      selectedComponentId: prev.selectedComponentId === id ? null : prev.selectedComponentId
    }));
  }, []);

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
    const x = Math.floor((event.clientX - gridRect.left - 10) / (layout.cellSize + 2));
    const y = Math.floor((event.clientY - gridRect.top - 10) / (layout.cellSize + 2));

    if (x >= 0 && x < layout.gridSize.width && y >= 0 && y < layout.gridSize.height) {
      handleAddComponent(editorState.draggedComponent.componentType, x, y);
    }

    setEditorState(prev => ({ ...prev, draggedComponent: null }));
  }, [editorState.draggedComponent, layout.cellSize, layout.gridSize, handleAddComponent]);

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
          <button 
            className={`tab ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            Preview
          </button>
        </div>

        <div className="editor-content">
          {activeTab === 'design' && (
            <div className="design-tab">
              <div className="component-palette">
                <h3>Components</h3>
                <div className="component-list">
                  {componentLibrary.map(component => (
                    <div
                      key={component.type}
                      className="component-item"
                      draggable
                      onDragStart={() => setEditorState(prev => ({
                        ...prev,
                        draggedComponent: {
                          componentType: component.type,
                          defaultSize: component.defaultSize
                        }
                      }))}
                      onClick={() => setEditorState(prev => ({
                        ...prev,
                        draggedComponent: {
                          componentType: component.type,
                          defaultSize: component.defaultSize
                        }
                      }))}
                    >
                      <span className="component-icon">{component.icon}</span>
                      <span className="component-name">{component.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="design-area">
                <div 
                  className="grid-container"
                  onClick={handleGridClick}
                >
                  <LayoutRenderer
                    layout={layout}
                    ros={ros}
                    isEditing={true}
                    selectedComponentId={editorState.selectedComponentId}
                    onComponentSelect={handleComponentSelect}
                    onComponentUpdate={handleComponentUpdate}
                    onComponentDelete={handleComponentDelete}
                  />
                </div>
              </div>

              {selectedComponent && (
                <div className="component-properties">
                  <h3>Properties</h3>
                  
                  {/* Position Controls */}
                  <div className="property-group">
                    <label>Position:</label>
                    <div className="position-controls">
                      <div className="position-control-group">
                        <label>X:</label>
                        <input
                          type="number"
                          min="0"
                          max={layout.gridSize.width - selectedComponent.position.width}
                          value={selectedComponent.position.x}
                          onChange={(e) => handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: {
                              ...selectedComponent.position,
                              x: parseInt(e.target.value) || 0
                            }
                          })}
                        />
                      </div>
                      <div className="position-control-group">
                        <label>Y:</label>
                        <input
                          type="number"
                          min="0"
                          max={layout.gridSize.height - selectedComponent.position.height}
                          value={selectedComponent.position.y}
                          onChange={(e) => handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: {
                              ...selectedComponent.position,
                              y: parseInt(e.target.value) || 0
                            }
                          })}
                        />
                      </div>
                    </div>
                    
                    {/* Move Buttons */}
                    <div className="move-buttons">
                      <button 
                        className="move-button"
                        onClick={() => {
                          const newX = Math.max(0, selectedComponent.position.x - 1);
                          handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: { ...selectedComponent.position, x: newX }
                          });
                        }}
                        disabled={selectedComponent.position.x <= 0}
                      >
                        ←
                      </button>
                      <button 
                        className="move-button"
                        onClick={() => {
                          const newY = Math.max(0, selectedComponent.position.y - 1);
                          handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: { ...selectedComponent.position, y: newY }
                          });
                        }}
                        disabled={selectedComponent.position.y <= 0}
                      >
                        ↑
                      </button>
                      <button 
                        className="move-button"
                        onClick={() => {
                          const newX = Math.min(
                            layout.gridSize.width - selectedComponent.position.width,
                            selectedComponent.position.x + 1
                          );
                          handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: { ...selectedComponent.position, x: newX }
                          });
                        }}
                        disabled={selectedComponent.position.x >= layout.gridSize.width - selectedComponent.position.width}
                      >
                        →
                      </button>
                      <button 
                        className="move-button"
                        onClick={() => {
                          const newY = Math.min(
                            layout.gridSize.height - selectedComponent.position.height,
                            selectedComponent.position.y + 1
                          );
                          handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: { ...selectedComponent.position, y: newY }
                          });
                        }}
                        disabled={selectedComponent.position.y >= layout.gridSize.height - selectedComponent.position.height}
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {/* Size Controls */}
                  <div className="property-group">
                    <label>Size:</label>
                    <div className="position-controls">
                      <div className="position-control-group">
                        <label>Width:</label>
                        <input
                          type="number"
                          min="1"
                          max={layout.gridSize.width - selectedComponent.position.x}
                          value={selectedComponent.position.width}
                          onChange={(e) => handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: {
                              ...selectedComponent.position,
                              width: parseInt(e.target.value) || 1
                            }
                          })}
                        />
                      </div>
                      <div className="position-control-group">
                        <label>Height:</label>
                        <input
                          type="number"
                          min="1"
                          max={layout.gridSize.height - selectedComponent.position.y}
                          value={selectedComponent.position.height}
                          onChange={(e) => handleComponentUpdate(selectedComponent.id, {
                            ...selectedComponent,
                            position: {
                              ...selectedComponent.position,
                              height: parseInt(e.target.value) || 1
                            }
                          })}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="property-group">
                    <label>Label:</label>
                    <input
                      type="text"
                      value={selectedComponent.label || ''}
                      onChange={(e) => handleComponentUpdate(selectedComponent.id, {
                        ...selectedComponent,
                        label: e.target.value
                      })}
                    />
                  </div>
                  <div className="property-group">
                    <label>Topic:</label>
                    <input
                      type="text"
                      value={(selectedComponent.action as any)?.topic || ''}
                      onChange={(e) => handleComponentUpdate(selectedComponent.id, {
                        ...selectedComponent,
                        action: {
                          ...selectedComponent.action,
                          topic: e.target.value
                        } as any
                      })}
                    />
                  </div>
                </div>
              )}
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
                <label>Grid Width:</label>
                <input
                  type="number"
                  min="4"
                  max="12"
                  value={layout.gridSize.width}
                  onChange={(e) => handleGridSizeChange(parseInt(e.target.value), layout.gridSize.height)}
                />
                <small>Recommended: 6-8 for mobile</small>
              </div>
              <div className="settings-group">
                <label>Grid Height:</label>
                <input
                  type="number"
                  min="3"
                  max="10"
                  value={layout.gridSize.height}
                  onChange={(e) => handleGridSizeChange(layout.gridSize.width, parseInt(e.target.value))}
                />
                <small>Recommended: 4-6 for mobile</small>
              </div>
              <div className="settings-group">
                <label>Cell Size:</label>
                <input
                  type="number"
                  min="60"
                  max="120"
                  step="10"
                  value={layout.cellSize}
                  onChange={(e) => handleCellSizeChange(parseInt(e.target.value))}
                />
                <small>Recommended: 80-100 for mobile</small>
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="preview-tab">
              <LayoutRenderer
                layout={layout}
                ros={ros}
                isEditing={false}
              />
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
    </div>
  );
};

export default GamepadEditor; 