import React, { useState, useMemo } from 'react';
import { VisualizationConfig } from './VisualizationPanel'; // Assuming types are exported
import './AddVisualizationModal.css';
// Import icons for visualization types
import { FaCloud, FaCamera, FaMapMarker, FaCubes } from 'react-icons/fa';

// Define structure for storing fetched topics (duplicated from Panel for now)
interface TopicInfo {
    name: string;
    type: string;
}

// Define known visualization types and their corresponding ROS message types
const SUPPORTED_VIZ_TYPES: Record<VisualizationConfig['type'], string[]> = {
  pointcloud: ['sensor_msgs/PointCloud2', 'sensor_msgs/msg/PointCloud2'],
  camerainfo: ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'],
  // Add more types here, e.g.:
  // marker: ['visualization_msgs/Marker', 'visualization_msgs/msg/Marker'],
  // markerarray: ['visualization_msgs/MarkerArray', 'visualization_msgs/msg/MarkerArray'],
};

// Define visualization type icons
const VIZ_TYPE_ICONS: Record<VisualizationConfig['type'], React.ReactNode> = {
  pointcloud: <FaCloud />,
  camerainfo: <FaCamera />,
  // Add more icons here as needed:
  // marker: <FaMapMarker />,
  // markerarray: <FaCubes />,
};

interface AddVisualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVisualization: (config: Omit<VisualizationConfig, 'id'>) => void;
  allTopics: TopicInfo[];
}

const AddVisualizationModal: React.FC<AddVisualizationModalProps> = ({
  isOpen,
  onClose,
  onAddVisualization,
  allTopics,
}) => {
  const [selectedTopic, setSelectedTopic] = useState<string>('');
  const [selectedType, setSelectedType] = useState<VisualizationConfig['type'] | ''>('');

  // Check if a type has available topics
  const getAvailableTopics = (type: VisualizationConfig['type']): TopicInfo[] => {
    const validRosTypes = SUPPORTED_VIZ_TYPES[type] || [];
    return allTopics.filter(topic => validRosTypes.includes(topic.type));
  };

  // Add quick visualization (auto-select first available topic)
  const addQuickVisualization = (type: VisualizationConfig['type']) => {
    const availableTopics = getAvailableTopics(type);
    
    if (availableTopics.length > 0) {
      const firstTopic = availableTopics[0].name;
      const config: Omit<VisualizationConfig, 'id'> = {
        type: type,
        topic: firstTopic,
        options: {},
      };
      onAddVisualization(config);
    }
  };

  // Helper function to capitalize type name for display
  const formatTypeName = (type: string): string => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Handle manual topic selection (only used if user wants to select a specific topic)
  const handleTypeSelect = (type: VisualizationConfig['type']) => {
    setSelectedType(type);
    setSelectedTopic('');
  };

  const handleTopicChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTopic(event.target.value);
  };

  const handleManualAddClick = () => {
    if (!selectedType || !selectedTopic) return;

    const config: Omit<VisualizationConfig, 'id'> = {
      type: selectedType,
      topic: selectedTopic,
      options: {},
    };
    onAddVisualization(config);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-viz-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Visualization</h2>

        <div className="viz-grid-section">
          <p className="section-label">Available Visualizations:</p>
          <div className="viz-grid">
            {Object.keys(SUPPORTED_VIZ_TYPES).map(type => {
              const vizType = type as VisualizationConfig['type'];
              const availableTopics = getAvailableTopics(vizType);
              const hasTopics = availableTopics.length > 0;
              const icon = VIZ_TYPE_ICONS[vizType];
              
              return (
                <button 
                  key={type}
                  className={`viz-grid-item ${!hasTopics ? 'disabled' : ''}`}
                  onClick={() => hasTopics && addQuickVisualization(vizType)}
                  disabled={!hasTopics}
                  title={!hasTopics 
                    ? 'No compatible topics available' 
                    : `Add ${formatTypeName(type)} (${availableTopics[0]?.name || 'first available topic'})`
                  }
                >
                  <div className="viz-icon">
                    {icon}
                  </div>
                  <div className="viz-name">{formatTypeName(type)}</div>
                  {hasTopics && (
                    <div className="viz-topic-count">{availableTopics.length} topic{availableTopics.length !== 1 ? 's' : ''}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="advanced-section">
          <details>
            <summary className="advanced-toggle">Advanced (select specific topic)</summary>
            <div className="advanced-content">
              <div className="form-group">
                <label htmlFor="advanced-viz-type">Visualization Type:</label>
                <select
                  id="advanced-viz-type"
                  value={selectedType}
                  onChange={(e) => handleTypeSelect(e.target.value as VisualizationConfig['type'])}
                >
                  <option value="" disabled>-- Select Type --</option>
                  {Object.keys(SUPPORTED_VIZ_TYPES).map(type => {
                    const vizType = type as VisualizationConfig['type'];
                    const hasTopics = getAvailableTopics(vizType).length > 0;
                    
                    return (
                      <option 
                        key={type} 
                        value={type}
                        disabled={!hasTopics}
                      >
                        {formatTypeName(type)} {!hasTopics ? '(No topics)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedType && (
                <div className="form-group">
                  <label htmlFor="viz-topic-select">Topic:</label>
                  <select
                    id="viz-topic-select"
                    value={selectedTopic}
                    onChange={handleTopicChange}
                  >
                    <option value="" disabled>-- Select Topic --</option>
                    {getAvailableTopics(selectedType).map(topic => (
                      <option key={topic.name} value={topic.name}>{topic.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <button
                className="manual-add-button"
                onClick={handleManualAddClick}
                disabled={!selectedType || !selectedTopic}
              >
                Add Selected Topic
              </button>
            </div>
          </details>
        </div>

        <div className="modal-actions">
          <button className="cancel-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default AddVisualizationModal; 