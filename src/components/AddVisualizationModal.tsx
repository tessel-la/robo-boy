import React, { useState, useMemo } from 'react';
import { VisualizationConfig } from './VisualizationPanel'; // Assuming types are exported
import './AddVisualizationModal.css';

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
  const [selectedType, setSelectedType] = useState<VisualizationConfig['type'] | '' >('');
  const [selectedTopic, setSelectedTopic] = useState<string>('');

  // Filter topics based on the selected visualization type
  const availableTopicsForType = useMemo(() => {
    if (!selectedType) return [];
    const validRosTypes = SUPPORTED_VIZ_TYPES[selectedType] || [];
    return allTopics.filter(topic => validRosTypes.includes(topic.type));
  }, [selectedType, allTopics]);

  // Reset topic when type changes
  const handleTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = event.target.value as VisualizationConfig['type'] | '';
    setSelectedType(newType);
    setSelectedTopic(''); // Reset topic selection
  };

  const handleTopicChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTopic(event.target.value);
  };

  const handleAddClick = () => {
    if (!selectedType || !selectedTopic) return; // Should be disabled, but double-check

    const config: Omit<VisualizationConfig, 'id'> = {
      type: selectedType,
      topic: selectedTopic,
      options: {}, // Start with empty options, add UI later if needed
    };
    onAddVisualization(config);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}> {/* Close on overlay click */}
      <div className="add-viz-modal" onClick={(e) => e.stopPropagation()}> {/* Prevent closing when clicking inside */}
        <h2>Add Visualization</h2>

        <div className="form-group">
          <label htmlFor="viz-type-select">Visualization Type:</label>
          <select
            id="viz-type-select"
            value={selectedType}
            onChange={handleTypeChange}
          >
            <option value="" disabled>-- Select Type --</option>
            {Object.keys(SUPPORTED_VIZ_TYPES).map(type => (
              <option key={type} value={type}>
                {/* Simple capitalization, improve if needed */}
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="viz-topic-select">Topic:</label>
          <select
            id="viz-topic-select"
            value={selectedTopic}
            onChange={handleTopicChange}
            disabled={!selectedType || availableTopicsForType.length === 0}
          >
            <option value="" disabled>
              {!selectedType
                ? '-- Select Type First --'
                : availableTopicsForType.length === 0
                ? '-- No compatible topics found --'
                : '-- Select Topic --'}
            </option>
            {availableTopicsForType.map(topic => (
              <option key={topic.name} value={topic.name}>{topic.name}</option>
            ))}
          </select>
        </div>

        {/* Add fields for options (color, scale, etc.) here later */}

        <div className="modal-actions">
          <button className="cancel-button" onClick={onClose}>Cancel</button>
          <button
            className="add-button"
            onClick={handleAddClick}
            disabled={!selectedType || !selectedTopic}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddVisualizationModal; 