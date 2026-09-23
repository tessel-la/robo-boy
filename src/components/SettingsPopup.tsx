import React, { useState } from 'react';
import { FaCog } from 'react-icons/fa';
import { FiArrowLeft, FiPlus, FiSettings, FiTrash2, FiX } from 'react-icons/fi';

import { getTopicsForVisualizationType, isTopicVisualizationType } from '../utils/visualizationTopics';
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

/** Each section collapses on its own; the open ones share the remaining height so the frame
 * list gets room instead of forcing a long scroll past everything else. */
/** One tab at a time owns the menu's height, so a frame list and a visualization list never
 * have to share it. */
type SettingsTab = 'frames' | 'visualizations';
type PopupView = 'main' | 'frameDisplay';

/** A length in scene metres. The slider is logarithmic so the small end (a few centimetres for a
 * desktop robot) has as much travel as the large end, and the number next to it is typed into
 * directly for an exact value. */
const ScaleField: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, disabled, onChange }) => {
  const SLIDER_STEPS = 1000;
  const toSlider = (metres: number) => Math.round((Math.log(Math.min(Math.max(metres, min), max) / min) / Math.log(max / min)) * SLIDER_STEPS);
  const fromSlider = (position: number) => min * Math.pow(max / min, position / SLIDER_STEPS);
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed) && parsed > 0) onChange(Math.min(Math.max(parsed, min), max));
    setDraft(null);
  };

  return (
    <div className="scale-field">
      <div className="control-heading-row">
        <label htmlFor={id}>{label}</label>
        <span className="scale-field-value">
          <input
            type="number"
            className="scale-field-number"
            aria-label={`${label} in metres`}
            min={min}
            max={max}
            step="0.01"
            disabled={disabled}
            value={draft ?? value.toFixed(2)}
            onChange={event => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') commitDraft();
            }}
          />
          <span>m</span>
        </span>
      </div>
      <input
        type="range"
        id={id}
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={toSlider(value)}
        disabled={disabled}
        onChange={event => onChange(Number(fromSlider(Number(event.target.value)).toFixed(3)))}
        className="range-input"
      />
    </div>
  );
};


const TYPE_LABELS: Record<VisualizationConfig['type'], string> = {
  pointcloud: 'Point Cloud',
  camerainfo: 'Camera Info',
  urdf: 'URDF',
  markerarray: 'Mesh markers',
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
  const [tab, setTab] = useState<SettingsTab>('frames');
  const [view, setView] = useState<PopupView>('main');
  const [frameFilter, setFrameFilter] = useState('');

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

  const compatibleTopicsFor = (vizType: VisualizationConfig['type']): TopicInfo[] =>
    isTopicVisualizationType(vizType) ? getTopicsForVisualizationType(vizType, allTopics) : [];

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
            <ScaleField
              id="tf-axes-scale"
              label="Axes size"
              value={tfDisplay.tfAxesScale}
              min={0.01}
              max={5}
              disabled={!tfDisplay.showTfAxes}
              onChange={tfAxesScale => onTfDisplayChange({ tfAxesScale })}
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
            <ScaleField
              id="tf-label-scale"
              label="Label size"
              value={tfDisplay.tfLabelScale}
              min={0.01}
              max={2}
              disabled={!tfDisplay.showTfFrameLabels}
              onChange={tfLabelScale => onTfDisplayChange({ tfLabelScale })}
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

        <div className="settings-tabs" role="tablist" aria-label="3D view settings sections">
          <button
            type="button"
            role="tab"
            id="settings-tab-frames"
            aria-selected={tab === 'frames'}
            aria-controls="settings-tabpanel-frames"
            className={`settings-tab${tab === 'frames' ? ' is-active' : ''}`}
            onClick={() => setTab('frames')}
          >
            <span>Frames</span>
            <span className="settings-count-badge">
              {displayedTfFrames.length}/{availableFrames.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-visualizations"
            aria-selected={tab === 'visualizations'}
            aria-controls="settings-tabpanel-visualizations"
            className={`settings-tab${tab === 'visualizations' ? ' is-active' : ''}`}
            onClick={() => setTab('visualizations')}
          >
            <span>Visualizations</span>
            <span className="settings-count-badge">{activeVisualizations.length}</span>
          </button>
        </div>

        {tab === 'frames' && (
          <section
            className="settings-tabpanel tf-section-content"
            role="tabpanel"
            id="settings-tabpanel-frames"
            aria-labelledby="settings-tab-frames"
          >
            <div className="tf-frame-toolbar">
              <input
                type="search"
                className="tf-frame-filter"
                value={frameFilter}
                onChange={event => setFrameFilter(event.target.value)}
                placeholder="Filter frames"
                aria-label="Filter frames"
                disabled={availableFrames.length === 0}
              />
              <button
                type="button"
                className="settings-icon-button"
                onClick={() => setView('frameDisplay')}
                title="Frame display settings"
                aria-label="Frame display settings"
              >
                <FiSettings aria-hidden="true" />
              </button>
            </div>

            <label className="settings-toggle-row">
              <span>Show all frames</span>
              <input
                type="checkbox"
                checked={showAllTfFrames}
                onChange={event => onShowAllTfFramesChange(event.target.checked)}
              />
            </label>

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
          </section>
        )}

        {tab === 'visualizations' && (
          <section
            className="settings-tabpanel active-visualizations-list"
            role="tabpanel"
            id="settings-tabpanel-visualizations"
            aria-labelledby="settings-tab-visualizations"
          >
            <button type="button" className="settings-nav-row is-primary" onClick={onAddVisualizationClick} aria-label="Add visualization">
              <FiPlus aria-hidden="true" />
              <span>Add visualization</span>
            </button>
          {activeVisualizations.length > 0 ? (
            <ul>
              {activeVisualizations.map(viz => {
                const compatibleTopics = compatibleTopicsFor(viz.type);
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
                            <FaCog aria-hidden="true" />
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
          </section>
        )}
      </div>
    </div>
  );
};

export default SettingsPopup;
