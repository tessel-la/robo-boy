import React, { useState, useMemo } from 'react';
import { VisualizationConfig, UrdfOptions } from './VisualizationPanel'; // Import UrdfOptions
import './AddVisualizationModal.css';
// Import icons for visualization types
import { FaCloud, FaCamera, FaMapMarker, FaCubes, FaCube, FaDotCircle } from 'react-icons/fa';

// Define structure for storing fetched topics (duplicated from Panel for now)
interface TopicInfo {
    name: string;
    type: string;
}

// Define known visualization types and their corresponding ROS message types
const SUPPORTED_VIZ_TYPES: Record<VisualizationConfig['type'], string[]> = {
  pointcloud: ['sensor_msgs/PointCloud2', 'sensor_msgs/msg/PointCloud2'],
  camerainfo: ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'],
  urdf: ['std_msgs/String', 'std_msgs/msg/String'], // URDF is often a string on /robot_description
  laserscan: ['sensor_msgs/msg/LaserScan'], // Added LaserScan
  // Add more types here, e.g.:
  // marker: ['visualization_msgs/Marker', 'visualization_msgs/msg/Marker'],
  // markerarray: ['visualization_msgs/MarkerArray', 'visualization_msgs/msg/MarkerArray'],
};

// Define visualization type icons
const VIZ_TYPE_ICONS: Record<VisualizationConfig['type'], React.ReactNode> = {
  pointcloud: <FaCloud />,
  camerainfo: <FaCamera />,
  urdf: <FaCube />,
  laserscan: <FaDotCircle />  // Updated LaserScan icon
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
  // Find all available URDF topics (std_msgs/String)
  const availableUrdfTopics = allTopics.filter(topic => SUPPORTED_VIZ_TYPES.urdf.includes(topic.type));
  const [urdfRobotDescriptionTopic, setUrdfRobotDescriptionTopic] = useState<string>(availableUrdfTopics[0]?.name || '');

  // Check if a type has available topics
  const getAvailableTopics = (type: VisualizationConfig['type']): TopicInfo[] => {
    if (type === 'urdf') {
      // For URDF, just return all available URDF topics
      return availableUrdfTopics;
    }
    const validRosTypes = SUPPORTED_VIZ_TYPES[type] || [];
    return allTopics.filter(topic => validRosTypes.includes(topic.type));
  };

  // Add quick visualization (auto-select first available topic)
  const addQuickVisualization = (type: VisualizationConfig['type']) => {
    const availableTopics = getAvailableTopics(type);
    let config: Omit<VisualizationConfig, 'id'>;

    if (type === 'urdf') {
      config = {
        type: 'urdf',
        // For quick add, use the first available topic (if any)
        topic: availableTopics[0]?.name || '',
        options: {
          robotDescriptionTopic: availableTopics[0]?.name || '',
        } as UrdfOptions,
      };
    } else if (availableTopics.length > 0) {
      const firstTopic = availableTopics[0].name;
      config = {
        type: type,
        topic: firstTopic,
        options: {},
      };
    } else {
      return; // Cannot add if no topics for non-URDF types
    }
    onAddVisualization(config);
  };

  // Helper function to capitalize type name for display
  const formatTypeName = (type: string): string => {
    if (type === 'urdf') return 'URDF';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Handle manual topic selection (only used if user wants to select a specific topic)
  const handleTypeSelect = (type: VisualizationConfig['type']) => {
    setSelectedType(type);
    if (type === 'urdf') {
      // Pre-fill topic if a common one exists, or clear if not
      const defaultUrdfTopic = getAvailableTopics('urdf').find(t => t.name.includes('robot_description'))?.name;
      setSelectedTopic(defaultUrdfTopic || '');
    } else {
    setSelectedTopic('');
    }
  };

  const handleTopicChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTopic(event.target.value);
  };

  const handleManualAddClick = () => {
    if (!selectedType) return;
    let config: Omit<VisualizationConfig, 'id'>;

    if (selectedType === 'urdf') {
      config = {
        type: 'urdf',
        topic: selectedTopic || urdfRobotDescriptionTopic, // Use selected or default from input
        options: {
          robotDescriptionTopic: urdfRobotDescriptionTopic,
        } as UrdfOptions,
      };
    } else {
      if (!selectedTopic) return;
      config = {
      type: selectedType,
      topic: selectedTopic,
      options: {},
    };
    }
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
              const hasTopicsOrIsUrdf = vizType === 'urdf' || availableTopics.length > 0;
              const icon = VIZ_TYPE_ICONS[vizType];
              
              let title = `Add ${formatTypeName(type)}`;
              if (vizType !== 'urdf' && hasTopicsOrIsUrdf) {
                title += ` (${availableTopics[0]?.name || 'first available'})`;
              } else if (vizType === 'urdf') {
                title += ` (default: ${urdfRobotDescriptionTopic})`;
              } else {
                title = 'No compatible topics available';
              }
              
              return (
                <button 
                  key={type}
                  className={`viz-grid-item ${!hasTopicsOrIsUrdf ? 'disabled' : ''}`}
                  onClick={() => hasTopicsOrIsUrdf && addQuickVisualization(vizType)}
                  disabled={!hasTopicsOrIsUrdf}
                  title={title}
                >
                  <div className="viz-icon">
                    {icon}
                  </div>
                  <div className="viz-name">{formatTypeName(type)}</div>
                  {vizType !== 'urdf' && hasTopicsOrIsUrdf && (
                    <div className="viz-topic-count">{availableTopics.length} topic{availableTopics.length !== 1 ? 's' : ''}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="advanced-section">
          <details>
            <summary className="advanced-toggle">Advanced (customize options)</summary>
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
                    const canAdd = vizType === 'urdf' || hasTopics;
                    return (
                      <option key={type} value={type} disabled={!canAdd}>
                        {formatTypeName(type)} {vizType !== 'urdf' && !hasTopics ? '(No topics)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedType && selectedType !== 'urdf' && (
                <div className="form-group">
                  <label htmlFor="viz-topic-select">Topic:</label>
                  <select id="viz-topic-select" value={selectedTopic} onChange={handleTopicChange}>
                    <option value="" disabled>-- Select Topic --</option>
                    {getAvailableTopics(selectedType).map(topic => (
                      <option key={topic.name} value={topic.name}>{topic.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedType === 'urdf' && (
                <>
                  <div className="form-group">
                    <label htmlFor="urdf-robot-description-topic">Robot Description Topic:</label>
                    <select
                      id="urdf-robot-description-topic"
                      value={urdfRobotDescriptionTopic}
                      onChange={(e) => setUrdfRobotDescriptionTopic(e.target.value)}
                      disabled={availableUrdfTopics.length === 0}
                    >
                      {availableUrdfTopics.length === 0 && (
                        <option value="" disabled>No URDF topics available</option>
                      )}
                      {availableUrdfTopics.map(topic => (
                        <option key={topic.name} value={topic.name}>{topic.name}</option>
                      ))}
                    </select>
                    {availableUrdfTopics.length === 0 && (
                      <div style={{ color: 'red', marginTop: 4 }}>No URDF topics of type std_msgs/String found.</div>
                    )}
                  </div>
                </>
              )}
              
              <button
                className="manual-add-button"
                onClick={handleManualAddClick}
                disabled={
                  !selectedType ||
                  (selectedType === 'urdf' && (!urdfRobotDescriptionTopic || availableUrdfTopics.length === 0)) ||
                  (selectedType !== 'urdf' && !selectedTopic)
                }
              >
                Add Visualization
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