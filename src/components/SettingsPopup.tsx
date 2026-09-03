import React, { useState } from 'react';
import { FiChevronDown, FiChevronRight, FiPlus, FiSettings, FiTrash2, FiX } from 'react-icons/fi';

import { getUrdfTopics } from '../utils/urdfTopics';
import type { VisualizationConfig } from './VisualizationPanel';
import './VisualizationPanel.css';

interface TopicInfo {
  name: string;
  type: string;
}

interface SettingsPopupProps {
  onClose: () => void;
  fixedFrame: string;
  availableFrames: string[];
  onFixedFrameChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  displayedTfFrames: string[];
  onDisplayedTfFramesChange: (selectedFrames: string[]) => void;
  showTfFrameLabels: boolean;
  onShowTfFrameLabelsChange: (show: boolean) => void;
  activeVisualizations: VisualizationConfig[];
  onRemoveVisualization: (id: string) => void;
  onAddVisualizationClick: () => void;
  onEditVisualization?: (id: string) => void;
  onUpdateVisualizationTopic?: (id: string, newTopic: string) => void;
  allTopics: TopicInfo[];
  tfAxesScale: number;
  onTfAxesScaleChange: (newScale: number) => void;
}

interface SectionVisibility {
  tfFrames: boolean;
  activeViz: boolean;
}

const TYPE_LABELS: Record<VisualizationConfig['type'], string> = {
  pointcloud: 'Point Cloud',
  camerainfo: 'Camera Info',
  urdf: 'URDF',
  laserscan: 'Laser Scan',
  tf: 'TF',
  posestamped: 'Pose Stamped',
};

const CONFIGURABLE_TYPES = new Set<VisualizationConfig['type']>(['pointcloud', 'laserscan', 'posestamped']);

const SettingsPopup: React.FC<SettingsPopupProps> = ({
  onClose,
  fixedFrame,
  availableFrames,
  onFixedFrameChange,
  displayedTfFrames,
  onDisplayedTfFramesChange,
  showTfFrameLabels,
  onShowTfFrameLabelsChange,
  activeVisualizations,
  onRemoveVisualization,
  onAddVisualizationClick,
  onEditVisualization,
  onUpdateVisualizationTopic,
  allTopics = [],
  tfAxesScale,
  onTfAxesScaleChange,
}) => {
  const [openSections, setOpenSections] = useState<SectionVisibility>({ tfFrames: false, activeViz: true });

  const toggleSection = (section: keyof SectionVisibility) => {
    setOpenSections(previous => ({ ...previous, [section]: !previous[section] }));
  };

  const handleTfCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const frameName = event.target.value;
    const nextFrames = event.target.checked
      ? Array.from(new Set([...displayedTfFrames, frameName]))
      : displayedTfFrames.filter(frame => frame !== frameName);
    onDisplayedTfFramesChange(nextFrames);
  };

  const handleEditClick = (id: string) => {
    onEditVisualization?.(id);
    onClose();
  };

  const handleTopicChange = (vizId: string, event: React.ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value) onUpdateVisualizationTopic?.(vizId, event.target.value);
  };

  const getTopicsForVisualizationType = (vizType: VisualizationConfig['type']): TopicInfo[] => {
    if (vizType === 'urdf') return getUrdfTopics(allTopics);

    const typeToMessageTypes: Partial<Record<VisualizationConfig['type'], string[]>> = {
      pointcloud: ['sensor_msgs/PointCloud2', 'sensor_msgs/msg/PointCloud2'],
      camerainfo: ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'],
      laserscan: ['sensor_msgs/LaserScan', 'sensor_msgs/msg/LaserScan'],
      posestamped: ['geometry_msgs/PoseStamped', 'geometry_msgs/msg/PoseStamped'],
    };
    const supportedTypes = typeToMessageTypes[vizType] ?? [];
    return allTopics.filter(topic => supportedTypes.includes(topic.type));
  };

  return (
    <div className="settings-popup">
      <header className="settings-popup-header">
        <div>
          <span className="settings-popup-kicker">Panel controls</span>
          <h3>3D View</h3>
        </div>
        <button type="button" onClick={onClose} className="close-button" aria-label="Close settings">
          <FiX aria-hidden="true" />
        </button>
      </header>

      <div className="settings-popup-content">
        <section className="settings-menu-section fixed-frame-section">
          <label className="settings-menu-label" htmlFor="fixed-frame-select">
            Fixed Frame:
          </label>
          <div className="settings-select-wrap">
            <select
              id="fixed-frame-select"
              value={fixedFrame}
              onChange={onFixedFrameChange}
              disabled={availableFrames.length === 0}
            >
              {availableFrames.length > 0 ? (
                availableFrames.map(frame => (
                  <option key={frame} value={frame}>
                    {frame}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  No frames available
                </option>
              )}
            </select>
          </div>
        </section>

        <section className="popup-section">
          <button
            type="button"
            className="section-header"
            onClick={() => toggleSection('tfFrames')}
            aria-expanded={openSections.tfFrames}
            aria-label="Displayed TF Frames"
          >
            <span className="section-heading-copy">
              <span className="settings-menu-label">TF display</span>
              <span className="section-heading-title">Displayed frames</span>
            </span>
            <span className="section-heading-meta">
              <span className="settings-count-badge">{displayedTfFrames.length}</span>
              {openSections.tfFrames ? <FiChevronDown /> : <FiChevronRight />}
            </span>
          </button>
          {openSections.tfFrames && (
            <div className="section-content tf-section-content">
              <div className="tf-scale-control">
                <div className="control-heading-row">
                  <label htmlFor="tf-axes-scale">TF Axes Size:</label>
                  <output htmlFor="tf-axes-scale" className="range-value">
                    {tfAxesScale.toFixed(1)}
                  </output>
                </div>
                <input
                  type="range"
                  id="tf-axes-scale"
                  min="0.1"
                  max="2"
                  step="0.1"
                  value={tfAxesScale}
                  onChange={event => onTfAxesScaleChange(parseFloat(event.target.value))}
                  className="range-input"
                />
              </div>

              <label className="settings-toggle-row">
                <span>Show frame labels</span>
                <input
                  type="checkbox"
                  checked={showTfFrameLabels}
                  onChange={event => onShowTfFrameLabelsChange(event.target.checked)}
                />
              </label>

              <div className="tf-frame-group">
                <div className="tf-frame-list-heading">
                  <span>Frames</span>
                  <span>{availableFrames.length} available</span>
                </div>
                {availableFrames.length > 0 ? (
                  <ul className="tf-checkbox-list">
                    {availableFrames.map(frame => (
                      <li key={frame}>
                        <label>
                          <span className="tf-frame-name">{frame}</span>
                          <input
                            type="checkbox"
                            value={frame}
                            checked={displayedTfFrames.includes(frame)}
                            onChange={handleTfCheckboxChange}
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-frames-message">No TF frames available.</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="popup-section active-visualizations-section">
          <div className="section-header-with-action">
            <button
              type="button"
              className="section-header"
              onClick={() => toggleSection('activeViz')}
              aria-expanded={openSections.activeViz}
            >
              <span className="section-heading-copy">
                <span className="settings-menu-label">Scene</span>
                <span className="section-heading-title">Active visualizations</span>
              </span>
              <span className="section-heading-meta">
                <span className="settings-count-badge">{activeVisualizations.length}</span>
                {openSections.activeViz ? <FiChevronDown /> : <FiChevronRight />}
              </span>
            </button>
            <button
              type="button"
              className="add-viz-popup-button"
              onClick={onAddVisualizationClick}
              title="Add visualization"
              aria-label="Add visualization"
            >
              <FiPlus aria-hidden="true" />
            </button>
          </div>

          {openSections.activeViz && (
            <div className="section-content active-visualizations-list">
              {activeVisualizations.length > 0 ? (
                <ul>
                  {activeVisualizations.map(viz => {
                    const compatibleTopics = getTopicsForVisualizationType(viz.type);
                    const currentTopicIsDiscovered = compatibleTopics.some(topic => topic.name === viz.topic);
                    const selectId = `visualization-topic-${viz.id}`;

                    return (
                      <li key={viz.id} className="visualization-item">
                        <div className="visualization-item-heading">
                          <span className="viz-type">{TYPE_LABELS[viz.type]}</span>
                          <div className="visualization-item-actions">
                            {CONFIGURABLE_TYPES.has(viz.type) && onEditVisualization && (
                              <button
                                type="button"
                                className="viz-settings-button"
                                onClick={() => handleEditClick(viz.id)}
                                title={`Configure ${TYPE_LABELS[viz.type]}`}
                                aria-label={`Edit ${TYPE_LABELS[viz.type]} visualization for topic ${viz.topic}`}
                              >
                                <FiSettings aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="remove-viz-button"
                              onClick={() => onRemoveVisualization(viz.id)}
                              title="Remove visualization"
                              aria-label={`Remove ${TYPE_LABELS[viz.type]} visualization for topic ${viz.topic}`}
                            >
                              <FiTrash2 aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <label className="viz-topic-label" htmlFor={selectId}>
                          Topic
                        </label>
                        <div className="topic-dropdown-container">
                          <select
                            id={selectId}
                            value={viz.topic}
                            onChange={event => handleTopicChange(viz.id, event)}
                            className="topic-dropdown"
                            title={viz.topic}
                          >
                            {!currentTopicIsDiscovered && <option value={viz.topic}>{viz.topic} (current)</option>}
                            {compatibleTopics.length > 0 ? (
                              compatibleTopics.map(topic => (
                                <option key={topic.name} value={topic.name}>
                                  {topic.name}
                                </option>
                              ))
                            ) : (
                              <option value="" disabled>
                                No compatible topics available
                              </option>
                            )}
                          </select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="no-visualizations-message">No active visualizations.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SettingsPopup;
