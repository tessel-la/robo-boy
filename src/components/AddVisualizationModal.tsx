import React, { useEffect, useMemo, useState } from 'react';
import { VisualizationConfig, UrdfOptions } from './VisualizationPanel'; // Import UrdfOptions
import './AddVisualizationModal.css';
// Import icons for visualization types
import { FaCloud, FaCamera, FaCube, FaDotCircle, FaArrowRight } from 'react-icons/fa';
import { getPreferredUrdfTopic, getUrdfTopics } from '../utils/urdfTopics';

// Define structure for storing fetched topics (duplicated from Panel for now)
interface TopicInfo {
  name: string;
  type: string;
}

// Define known visualization types and their corresponding ROS message types
const SUPPORTED_VIZ_TYPES: Record<Exclude<VisualizationConfig['type'], 'tf'>, string[]> = {
  pointcloud: ['sensor_msgs/PointCloud2', 'sensor_msgs/msg/PointCloud2'],
  camerainfo: ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'],
  urdf: ['std_msgs/String', 'std_msgs/msg/String'], // URDF is often a string on /robot_description
  laserscan: ['sensor_msgs/msg/LaserScan'], // Added LaserScan
  posestamped: ['geometry_msgs/PoseStamped', 'geometry_msgs/msg/PoseStamped'], // Added PoseStamped
  // TF is excluded - controlled via Settings menu "Displayed TF Frames" section
  // Add more types here, e.g.:
  // marker: ['visualization_msgs/Marker', 'visualization_msgs/msg/Marker'],
  // markerarray: ['visualization_msgs/MarkerArray', 'visualization_msgs/msg/MarkerArray'],
};

// Define visualization type icons
const VIZ_TYPE_ICONS: Record<Exclude<VisualizationConfig['type'], 'tf'>, React.ReactNode> = {
  pointcloud: <FaCloud />,
  camerainfo: <FaCamera />,
  urdf: <FaCube />,
  laserscan: <FaDotCircle />, // Updated LaserScan icon
  posestamped: <FaArrowRight />, // PoseStamped icon
  // TF icon excluded - controlled via Settings menu
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
  const [selectedType, setSelectedType] = useState<Exclude<VisualizationConfig['type'], 'tf'> | ''>('');
  const [manualTopicInput, setManualTopicInput] = useState<string>('');
  const [useManualInput, setUseManualInput] = useState<boolean>(false);
  // A URDF uses String transport, but ordinary String topics are not robot
  // descriptions. Follow the ROS robot_description naming convention too.
  const availableUrdfTopics = useMemo(() => getUrdfTopics(allTopics), [allTopics]);
  const [urdfRobotDescriptionTopic, setUrdfRobotDescriptionTopic] = useState<string>(
    getPreferredUrdfTopic(availableUrdfTopics)?.name || ''
  );

  useEffect(() => {
    if (useManualInput) return;
    const currentTopicStillAvailable = availableUrdfTopics.some(topic => topic.name === urdfRobotDescriptionTopic);
    if (!currentTopicStillAvailable) {
      setUrdfRobotDescriptionTopic(getPreferredUrdfTopic(availableUrdfTopics)?.name || '');
    }
  }, [availableUrdfTopics, urdfRobotDescriptionTopic, useManualInput]);

  // Check if a type has available topics
  const getAvailableTopics = (type: Exclude<VisualizationConfig['type'], 'tf'>): TopicInfo[] => {
    if (type === 'urdf') {
      // For URDF, just return all available URDF topics
      return availableUrdfTopics;
    }

    const validRosTypes = SUPPORTED_VIZ_TYPES[type] || [];
    const filteredTopics = allTopics.filter(topic => validRosTypes.includes(topic.type));

    // Debug logging for PoseStamped specifically
    if (type === 'posestamped') {
      console.log('[AddVisualizationModal] PoseStamped topic filtering:');
      console.log('  Valid ROS types:', validRosTypes);
      console.log('  All topics:', allTopics.length);
      console.log('  All topics sample:', allTopics.slice(0, 3));
      console.log('  Filtered topics:', filteredTopics);
      console.log('  Filtered topics length:', filteredTopics.length);
      console.log('  All topic types:', [...new Set(allTopics.map(t => t.type))]);

      // Test the filtering manually
      const manualTest = allTopics.filter(
        topic => topic.type === 'geometry_msgs/msg/PoseStamped' || topic.type === 'geometry_msgs/PoseStamped'
      );
      console.log('  Manual filter test:', manualTest);
    }

    return filteredTopics;
  };

  // Add quick visualization (auto-select first available topic)
  const addQuickVisualization = (type: Exclude<VisualizationConfig['type'], 'tf'>) => {
    const availableTopics = getAvailableTopics(type);
    let config: Omit<VisualizationConfig, 'id'>;

    if (type === 'urdf') {
      const preferredTopic = getPreferredUrdfTopic(availableTopics)?.name;
      if (!preferredTopic) return;
      config = {
        type: 'urdf',
        topic: preferredTopic,
        options: {
          robotDescriptionTopic: preferredTopic,
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
    if (type === 'posestamped') return 'PoseStamped';
    if (type === 'laserscan') return 'LaserScan';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Handle manual topic selection (only used if user wants to select a specific topic)
  const handleTypeSelect = (type: Exclude<VisualizationConfig['type'], 'tf'> | '') => {
    setSelectedType(type);
    setUseManualInput(false);
    setManualTopicInput('');
    if (type === 'urdf') {
      setUrdfRobotDescriptionTopic(getPreferredUrdfTopic(availableUrdfTopics)?.name || '');
      setSelectedTopic('');
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
      const topicToUse = useManualInput ? manualTopicInput.trim() : urdfRobotDescriptionTopic;
      if (!topicToUse) return;
      config = {
        type: 'urdf',
        topic: topicToUse,
        options: {
          robotDescriptionTopic: topicToUse,
        } as UrdfOptions,
      };
    } else {
      // Use manual input if available, otherwise use selected topic
      const topicToUse = useManualInput ? manualTopicInput : selectedTopic;
      if (!topicToUse) return;
      config = {
        type: selectedType,
        topic: topicToUse,
        options: {},
      };
    }
    onAddVisualization(config);
  };

  if (!isOpen) return null;

  // Debug: Log when modal opens
  console.log('[AddVisualizationModal] Modal opened with topics:', allTopics.length);
  if (allTopics.length === 0) {
    console.log('[AddVisualizationModal] WARNING: No topics available when modal opened!');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-viz-modal" onClick={e => e.stopPropagation()}>
        <div className="add-viz-modal-header">
          <h2>Add Visualization</h2>
          <button className="add-viz-close-button" onClick={onClose} aria-label="Close add visualization menu">
            &times;
          </button>
        </div>

        <div className="add-viz-modal-body">
          <div className="viz-grid-section">
            <p className="section-label">Available Visualizations:</p>
            <div className="viz-grid">
              {Object.keys(SUPPORTED_VIZ_TYPES).map(type => {
                const vizType = type as Exclude<VisualizationConfig['type'], 'tf'>;
                const availableTopics = getAvailableTopics(vizType);
                const hasTopics = availableTopics.length > 0;
                const icon = VIZ_TYPE_ICONS[vizType];

                // Debug logging for PoseStamped specifically in grid rendering
                if (vizType === 'posestamped') {
                  console.log('[AddVisualizationModal] PoseStamped grid rendering:');
                  console.log('  Available topics:', availableTopics);
                  console.log('  Has topics:', hasTopics);
                  console.log('  All topics count:', allTopics.length);
                }

                let title = `Add ${formatTypeName(type)}`;
                if (vizType !== 'urdf' && hasTopics) {
                  title += ` (${availableTopics[0]?.name || 'first available'})`;
                } else if (vizType === 'urdf' && hasTopics) {
                  title += ` (default: ${urdfRobotDescriptionTopic})`;
                } else if (vizType === 'urdf') {
                  title = 'No conventional robot_description topic found; use Advanced for a remapped topic';
                } else {
                  title = 'No compatible topics available';
                }

                return (
                  <button
                    key={type}
                    className={`viz-grid-item ${!hasTopics ? 'disabled' : ''}`}
                    onClick={() => hasTopics && addQuickVisualization(vizType)}
                    disabled={!hasTopics}
                    title={title}
                  >
                    <div className="viz-icon">{icon}</div>
                    <div className="viz-name">{formatTypeName(type)}</div>
                    {hasTopics && (
                      <div className="viz-topic-count">
                        {availableTopics.length} topic{availableTopics.length !== 1 ? 's' : ''}
                      </div>
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
                    onChange={e => handleTypeSelect(e.target.value as Exclude<VisualizationConfig['type'], 'tf'> | '')}
                  >
                    <option value="" disabled>
                      -- Select Type --
                    </option>
                    {Object.keys(SUPPORTED_VIZ_TYPES).map(type => {
                      const vizType = type as Exclude<VisualizationConfig['type'], 'tf'>;
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
                    {!useManualInput ? (
                      <div>
                        <select id="viz-topic-select" value={selectedTopic} onChange={handleTopicChange}>
                          <option value="" disabled>
                            -- Select Topic --
                          </option>
                          {getAvailableTopics(selectedType).map(topic => (
                            <option key={topic.name} value={topic.name}>
                              {topic.name}
                            </option>
                          ))}
                        </select>
                        <div className="manual-topic-actions">
                          <button
                            type="button"
                            className="secondary-inline-button"
                            onClick={() => setUseManualInput(true)}
                          >
                            Enter topic manually
                          </button>
                          {getAvailableTopics(selectedType).length === 0 && (
                            <div className="add-viz-field-warning">
                              No {selectedType} topics found. Try manual input.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <input
                          type="text"
                          id="manual-topic-input"
                          placeholder={`Enter ${selectedType} topic (e.g., /drone0/joy_control/target_pose)`}
                          value={manualTopicInput}
                          onChange={e => setManualTopicInput(e.target.value)}
                          className="manual-topic-input"
                        />
                        <button
                          type="button"
                          className="secondary-inline-button"
                          onClick={() => {
                            setUseManualInput(false);
                            setManualTopicInput('');
                          }}
                        >
                          Back to topic list
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {selectedType === 'urdf' && (
                  <div className="form-group">
                    <label htmlFor={useManualInput ? 'manual-urdf-topic-input' : 'urdf-robot-description-topic'}>
                      Robot Description Topic:
                    </label>
                    {!useManualInput ? (
                      <div>
                        <select
                          id="urdf-robot-description-topic"
                          value={urdfRobotDescriptionTopic}
                          onChange={e => setUrdfRobotDescriptionTopic(e.target.value)}
                          disabled={availableUrdfTopics.length === 0}
                        >
                          {availableUrdfTopics.length === 0 && (
                            <option value="" disabled>
                              No URDF topics available
                            </option>
                          )}
                          {availableUrdfTopics.map(topic => (
                            <option key={topic.name} value={topic.name}>
                              {topic.name}
                            </option>
                          ))}
                        </select>
                        <div className="manual-topic-actions">
                          <button
                            type="button"
                            className="secondary-inline-button"
                            onClick={() => setUseManualInput(true)}
                          >
                            Enter remapped topic manually
                          </button>
                        </div>
                        {availableUrdfTopics.length === 0 && (
                          <div className="add-viz-field-warning">
                            No robot_description String topic found. Enter a remapped topic manually.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <input
                          type="text"
                          id="manual-urdf-topic-input"
                          placeholder="Enter robot description topic (e.g., /my_robot/model)"
                          value={manualTopicInput}
                          onChange={e => setManualTopicInput(e.target.value)}
                          className="manual-topic-input"
                        />
                        <button
                          type="button"
                          className="secondary-inline-button"
                          onClick={() => {
                            setUseManualInput(false);
                            setManualTopicInput('');
                          }}
                        >
                          Back to discovered topics
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button
                  className="manual-add-button"
                  onClick={handleManualAddClick}
                  disabled={
                    !selectedType ||
                    (selectedType === 'urdf' &&
                      (useManualInput ? !manualTopicInput.trim() : !urdfRobotDescriptionTopic)) ||
                    (selectedType !== 'urdf' && !useManualInput && !selectedTopic) ||
                    (selectedType !== 'urdf' && useManualInput && !manualTopicInput)
                  }
                >
                  Add Visualization
                </button>
              </div>
            </details>
          </div>
        </div>

        <div className="modal-actions">
          <button className="cancel-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddVisualizationModal;
