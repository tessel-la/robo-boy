import React, { useState } from 'react';
import { FiArrowLeft, FiPlus, FiSettings, FiTrash2, FiX, FiInfo } from 'react-icons/fi';

import { getTopicsForVisualizationType, isTopicVisualizationType } from '../utils/visualizationTopics';
import ScaleField from './ScaleField';
import { PercentField, SelectField, ToggleRow } from './SettingsFields';
import LayerSettings, { hasLayerSettings, type LayerOptionsPatch } from './visualizers/LayerSettings';
import type { TfDisplaySettings } from '../utils/visualizationState';
import type { VisualizationConfig } from './VisualizationPanel';
import './VisualizationPanel.css';
import './PanelSettings.css';

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
  onUpdateVisualizationOptions?: (id: string, options: LayerOptionsPatch) => void;
  onUpdateVisualizationTopic?: (id: string, newTopic: string) => void;
  allTopics: TopicInfo[];
  visualizationStatus?: Record<string, string | null>;
  onInspectCamera?: (id: string) => void;
}

/** One tab at a time owns the menu's height, so a frame list and a visualization list never
 * have to share it. */
type SettingsTab = 'frames' | 'visualizations';
/** Detail settings open as their own view inside the menu, with a way back: the frame display,
 * or one layer's settings by its id. */
type PopupView = { kind: 'main' } | { kind: 'frameDisplay' } | { kind: 'layer'; id: string };

const TYPE_LABELS: Record<VisualizationConfig['type'], string> = {
  pointcloud: 'Point Cloud',
  camerainfo: 'Camera Info',
  urdf: 'URDF',
  markerarray: 'Mesh markers',
  laserscan: 'Laser Scan',
  tf: 'TF',
  posestamped: 'Pose Stamped',
  path: 'Path',
  occupancygrid: 'Occupancy grid',
  cameraimage: 'Camera image',
  jointstate: 'Joint states',
};

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
  visualizationStatus,
  onRemoveVisualization,
  onAddVisualizationClick,
  onUpdateVisualizationTopic,
  onUpdateVisualizationOptions,
  allTopics = [],
  onInspectCamera,
}) => {
  const [tab, setTab] = useState<SettingsTab>('frames');
  const [view, setView] = useState<PopupView>({ kind: 'main' });
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

  const handleTopicChange = (vizId: string, topic: string) => {
    if (topic) onUpdateVisualizationTopic?.(vizId, topic);
  };

  const compatibleTopicsFor = (vizType: VisualizationConfig['type']): TopicInfo[] =>
    isTopicVisualizationType(vizType) ? getTopicsForVisualizationType(vizType, allTopics) : [];

  const detailHeader = (kicker: string, title: string) => (
    <header className="settings-popup-header">
      <button
        type="button"
        onClick={() => setView({ kind: 'main' })}
        className="close-button"
        aria-label="Back to 3D view settings"
      >
        <FiArrowLeft aria-hidden="true" />
      </button>
      <div className="settings-popup-heading">
        <span className="settings-popup-kicker">{kicker}</span>
        <h3 title={title}>{title}</h3>
      </div>
      <button type="button" onClick={onClose} className="close-button" aria-label="Close settings">
        <FiX aria-hidden="true" />
      </button>
    </header>
  );

  const layer = view.kind === 'layer' ? activeVisualizations.find(viz => viz.id === view.id) : undefined;
  if (layer && onUpdateVisualizationOptions) {
    return (
      <div className="settings-popup panel-settings">
        {detailHeader(TYPE_LABELS[layer.type], layer.topic)}
        <div key={layer.id} className="settings-popup-content layer-settings-content">
          {visualizationStatus?.[layer.id] && (
            <p role="status" className="visualization-status">
              {visualizationStatus[layer.id]}
            </p>
          )}
          {layer.type === 'cameraimage' && onInspectCamera && (
            <button
              type="button"
              className="settings-nav-row"
              aria-label={`Inspect camera on ${layer.topic}`}
              onClick={() => onInspectCamera(layer.id)}
            >
              <FiInfo aria-hidden="true" />
              <span>Inspect camera</span>
            </button>
          )}
          <LayerSettings
            surfaceLayers={activeVisualizations.filter(item => item.type === 'urdf' || item.type === 'markerarray')}
            viz={layer}
            typeLabel={TYPE_LABELS[layer.type]}
            topics={allTopics}
            onChange={onUpdateVisualizationOptions}
          />
        </div>
      </div>
    );
  }

  if (view.kind === 'frameDisplay') {
    return (
      <div className="settings-popup panel-settings">
        {detailHeader('TF frames', 'Frame display')}

        <div className="settings-popup-content frame-display-content">
          <ToggleRow
            label="Show axes"
            checked={tfDisplay.showTfAxes}
            onChange={showTfAxes => onTfDisplayChange({ showTfAxes })}
          />
          <div className="viz-settings-group">
            <ScaleField
              id="tf-axes-scale"
              label="Axes length"
              value={tfDisplay.tfAxesScale}
              min={0.01}
              max={5}
              disabled={!tfDisplay.showTfAxes}
              onChange={tfAxesScale => onTfDisplayChange({ tfAxesScale })}
            />
            <ScaleField
              id="tf-axes-width"
              label="Axes width"
              value={tfDisplay.tfAxesWidth}
              min={0.001}
              max={0.1}
              precision={3}
              disabled={!tfDisplay.showTfAxes}
              onChange={tfAxesWidth => onTfDisplayChange({ tfAxesWidth })}
            />
            <PercentField
              id="tf-axes-opacity"
              label="Axes opacity"
              min={0.1}
              value={tfDisplay.tfAxesOpacity}
              disabled={!tfDisplay.showTfAxes}
              onChange={tfAxesOpacity => onTfDisplayChange({ tfAxesOpacity })}
            />
          </div>

          <ToggleRow
            label="Show labels"
            checked={tfDisplay.showTfFrameLabels}
            onChange={showTfFrameLabels => onTfDisplayChange({ showTfFrameLabels })}
          />
          <ToggleRow
            label="Label background"
            checked={tfDisplay.showTfLabelBackground}
            disabled={!tfDisplay.showTfFrameLabels}
            onChange={showTfLabelBackground => onTfDisplayChange({ showTfLabelBackground })}
          />
          <div className="viz-settings-group">
            <ScaleField
              id="tf-label-scale"
              label="Label size"
              value={tfDisplay.tfLabelScale}
              min={0.01}
              max={2}
              disabled={!tfDisplay.showTfFrameLabels}
              onChange={tfLabelScale => onTfDisplayChange({ tfLabelScale })}
            />
            <PercentField
              id="tf-label-opacity"
              label="Label opacity"
              min={0.1}
              value={tfDisplay.tfLabelOpacity}
              disabled={!tfDisplay.showTfFrameLabels}
              onChange={tfLabelOpacity => onTfDisplayChange({ tfLabelOpacity })}
            />
          </div>

          <ToggleRow
            label="Show parent links"
            checked={tfDisplay.showTfConnections}
            onChange={showTfConnections => onTfDisplayChange({ showTfConnections })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-popup panel-settings">
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
                onClick={() => setView({ kind: 'frameDisplay' })}
                title="Frame display settings"
                aria-label="Frame display settings"
              >
                <FiSettings aria-hidden="true" />
              </button>
            </div>

            <ToggleRow label="Show all frames" checked={showAllTfFrames} onChange={onShowAllTfFramesChange} />

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
            <button
              type="button"
              className="settings-nav-row is-primary"
              onClick={onAddVisualizationClick}
              aria-label="Add visualization"
            >
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
                          {(viz.type === 'cameraimage' || viz.type === 'camerainfo') && onInspectCamera && (
                            <button
                              type="button"
                              className="viz-settings-button"
                              title="Inspect camera"
                              aria-label={`Inspect camera on ${viz.topic}`}
                              onClick={() => onInspectCamera(viz.id)}
                            >
                              <FiInfo aria-hidden="true" />
                            </button>
                          )}
                          {hasLayerSettings(viz.type) && onUpdateVisualizationOptions && (
                            <button
                              type="button"
                              className="viz-settings-button"
                              onClick={() => setView({ kind: 'layer', id: viz.id })}
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

                      <SelectField
                        id={selectId}
                        label="Topic"
                        value={viz.topic}
                        title={viz.topic}
                        onChange={topic => handleTopicChange(viz.id, topic)}
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
                      </SelectField>
                      {visualizationStatus?.[viz.id] && (
                        <p role="status" className="visualization-status">
                          {visualizationStatus[viz.id]}
                        </p>
                      )}
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
