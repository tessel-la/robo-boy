import React, { useState } from 'react';
import { FiArrowLeft, FiChevronDown, FiChevronRight, FiPlus, FiSettings, FiTrash2, FiX } from 'react-icons/fi';

import { getUrdfTopics } from '../utils/urdfTopics';
import type { TfDisplaySettings } from '../utils/visualizationState';
import type { VisualizationConfig } from './VisualizationPanel';
import './VisualizationPanel.css';

interface TopicInfo {
  name: string;
  type: string;
}

interface SettingsPopupProps {
  onClose: () => void;
  /** The frame the scene is anchored to right now; it is picked automatically until the user
   * chooses one, so the selector never asks for an "auto" mode. */
  fixedFrame: string;
  availableFrames: string[];
  onFixedFrameChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  displayedTfFrames: string[];
  onDisplayedTfFramesChange: (selectedFrames: string[]) => void;
  showAllTfFrames: boolean;
  onShowAllTfFramesChange: (showAll: boolean) => void;
  tfDisplay: TfDisplaySettings;
  onTfDisplayChange: (patch: Partial<TfDisplaySettings>) => void;
  activeVisualizations: VisualizationConfig[];
  onRemoveVisualization: (id: string) => void;
  onAddVisualizationClick: () => void;
  onEditVisualization?: (id: string) => void;
  onUpdateVisualizationTopic?: (id: string, newTopic: string) => void;
  allTopics: TopicInfo[];
}

/** One section is expanded at a time and takes the remaining height, so the frame list gets the
 * room it needs instead of forcing a long scroll past everything else. */
type OpenSection = 'tfFrames' | 'activeViz';
type PopupView = 'main' | 'frameDisplay';

const FRAME_FILTER_THRESHOLD = 6;

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
  showAllTfFrames,
  onShowAllTfFramesChange,
  tfDisplay,
  onTfDisplayChange,
  activeVisualizations,
  onRemoveVisualization,
  onAddVisualizationClick,
  onEditVisualization,
  onUpdateVisualizationTopic,
  allTopics = [],
}) => {
  const [openSection, setOpenSection] = useState<OpenSection>('tfFrames');
  const [view, setView] = useState<PopupView>('main');
  const [frameFilter, setFrameFilter] = useState('');

  const toggleSection = (section: OpenSection) => {
    setOpenSection(previous => (previous === section ? 'tfFrames' : section));
  };

  const handleTfCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const frameName = event.target.value;
    const nextFrames = event.target.checked
      ? Array.from(new Set([...displayedTfFrames, frameName]))
      : displayedTfFrames.filter(frame => frame !== frameName);
    onDisplayedTfFramesChange(nextFrames);
  };

  const normalizedFilter = frameFilter.trim().toLowerCase();
  const filteredFrames = normalizedFilter
    ? availableFrames.filter(frame => frame.toLowerCase().includes(normalizedFilter))
    : availableFrames;

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

  if (view === 'frameDisplay') {
    return (
      <div className="settings-popup">
        <header className="settings-popup-header">
          <button
            type="button"
            onClick={() => setView('main')}
            className="close-button"
            aria-label="Back to 3D view settings"
          >
            <FiArrowLeft aria-hidden="true" />
          </button>
          <div className="settings-popup-heading">
            <span className="settings-popup-kicker">TF frames</span>
            <h3>Frame display</h3>
          </div>
          <button type="button" onClick={onClose} className="close-button" aria-label="Close settings">
            <FiX aria-hidden="true" />
          </button>
        </header>

        <div className="settings-popup-content frame-display-content">
          <label className="settings-toggle-row">
            <span>Show axes</span>
            <input
              type="checkbox"
              checked={tfDisplay.showTfAxes}
              onChange={event => onTfDisplayChange({ showTfAxes: event.target.checked })}
            />
          </label>
          <div className="tf-scale-control">
            <div className="control-heading-row">
              <label htmlFor="tf-axes-scale">Axes size</label>
              <output htmlFor="tf-axes-scale" className="range-value">
                {tfDisplay.tfAxesScale.toFixed(2)} m
              </output>
            </div>
            <input
              type="range"
              id="tf-axes-scale"
              min="0.05"
              max="2"
              step="0.05"
              value={tfDisplay.tfAxesScale}
              disabled={!tfDisplay.showTfAxes}
              onChange={event => onTfDisplayChange({ tfAxesScale: parseFloat(event.target.value) })}
              className="range-input"
            />
            <div className="control-heading-row">
              <label htmlFor="tf-axes-opacity">Axes opacity</label>
              <output htmlFor="tf-axes-opacity" className="range-value">
                {Math.round(tfDisplay.tfAxesOpacity * 100)}%
              </output>
            </div>
            <input
              type="range"
              id="tf-axes-opacity"
              min="0.1"
              max="1"
              step="0.05"
              value={tfDisplay.tfAxesOpacity}
              disabled={!tfDisplay.showTfAxes}
              onChange={event => onTfDisplayChange({ tfAxesOpacity: parseFloat(event.target.value) })}
              className="range-input"
            />
          </div>

          <label className="settings-toggle-row">
            <span>Show labels</span>
            <input
              type="checkbox"
              checked={tfDisplay.showTfFrameLabels}
              onChange={event => onTfDisplayChange({ showTfFrameLabels: event.target.checked })}
            />
          </label>
          <label className="settings-toggle-row">
            <span>Label background</span>
            <input
              type="checkbox"
              checked={tfDisplay.showTfLabelBackground}
              disabled={!tfDisplay.showTfFrameLabels}
              onChange={event => onTfDisplayChange({ showTfLabelBackground: event.target.checked })}
            />
          </label>
          <div className="tf-scale-control">
            <div className="control-heading-row">
              <label htmlFor="tf-label-scale">Label size</label>
              <output htmlFor="tf-label-scale" className="range-value">
                {tfDisplay.tfLabelScale.toFixed(2)} m
              </output>
            </div>
            <input
              type="range"
              id="tf-label-scale"
              min="0.02"
              max="1"
              step="0.02"
              value={tfDisplay.tfLabelScale}
              disabled={!tfDisplay.showTfFrameLabels}
              onChange={event => onTfDisplayChange({ tfLabelScale: parseFloat(event.target.value) })}
              className="range-input"
            />
            <div className="control-heading-row">
              <label htmlFor="tf-label-opacity">Label opacity</label>
              <output htmlFor="tf-label-opacity" className="range-value">
                {Math.round(tfDisplay.tfLabelOpacity * 100)}%
              </output>
            </div>
            <input
              type="range"
              id="tf-label-opacity"
              min="0.1"
              max="1"
              step="0.05"
              value={tfDisplay.tfLabelOpacity}
              disabled={!tfDisplay.showTfFrameLabels}
              onChange={event => onTfDisplayChange({ tfLabelOpacity: parseFloat(event.target.value) })}
              className="range-input"
            />
          </div>

          <label className="settings-toggle-row">
            <span>Show parent links</span>
            <input
              type="checkbox"
              checked={tfDisplay.showTfConnections}
              onChange={event => onTfDisplayChange({ showTfConnections: event.target.checked })}
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-popup">
      <header className="settings-popup-header">
        <div className="settings-popup-heading">
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
              value={availableFrames.includes(fixedFrame) ? fixedFrame : ''}
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

        <section className={`popup-section tf-frames-section${openSection === 'tfFrames' ? ' is-open' : ''}`}>
          <div className="section-header-with-action">
            <button
              type="button"
              className="section-header"
              onClick={() => toggleSection('tfFrames')}
              aria-expanded={openSection === 'tfFrames'}
              aria-label="TF frames"
            >
              <span className="section-heading-copy">
                <span className="settings-menu-label">TF display</span>
                <span className="section-heading-title">Frames</span>
              </span>
              <span className="section-heading-meta">
                <span className="settings-count-badge">
                  {displayedTfFrames.length}/{availableFrames.length}
                </span>
                {openSection === 'tfFrames' ? <FiChevronDown /> : <FiChevronRight />}
              </span>
            </button>
            <button
              type="button"
              className="settings-icon-button section-action-button"
              onClick={() => setView('frameDisplay')}
              title="Frame display settings"
              aria-label="Frame display settings"
            >
              <FiSettings aria-hidden="true" />
            </button>
          </div>

          {openSection === 'tfFrames' && (
            <div className="section-content tf-section-content">
              <label className="settings-toggle-row">
                <span>Show all frames</span>
                <input
                  type="checkbox"
                  checked={showAllTfFrames}
                  onChange={event => onShowAllTfFramesChange(event.target.checked)}
                />
              </label>

              {availableFrames.length > FRAME_FILTER_THRESHOLD && (
                <input
                  type="search"
                  className="tf-frame-filter"
                  value={frameFilter}
                  onChange={event => setFrameFilter(event.target.value)}
                  placeholder="Filter frames"
                  aria-label="Filter frames"
                />
              )}

              {availableFrames.length > 0 ? (
                filteredFrames.length > 0 ? (
                  <ul className="tf-checkbox-list">
                    {filteredFrames.map(frame => (
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
                  <p className="no-frames-message">No frames match “{frameFilter.trim()}”.</p>
                )
              ) : (
                <p className="no-frames-message">No TF frames available.</p>
              )}
            </div>
          )}
        </section>

        <section className={`popup-section active-visualizations-section${openSection === 'activeViz' ? ' is-open' : ''}`}>
          <div className="section-header-with-action">
            <button
              type="button"
              className="section-header"
              onClick={() => toggleSection('activeViz')}
              aria-expanded={openSection === 'activeViz'}
            >
              <span className="section-heading-copy">
                <span className="settings-menu-label">Scene</span>
                <span className="section-heading-title">Active visualizations</span>
              </span>
              <span className="section-heading-meta">
                <span className="settings-count-badge">{activeVisualizations.length}</span>
                {openSection === 'activeViz' ? <FiChevronDown /> : <FiChevronRight />}
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

          {openSection === 'activeViz' && (
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
