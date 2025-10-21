import React, { useState, useEffect, ChangeEvent } from 'react';
import * as THREE from 'three';
import { PoseStampedOptions } from '../../hooks/usePoseStampedClient';
import { FiChevronDown, FiChevronRight } from 'react-icons/fi';
import './TopicSettings.css';

export interface PoseStampedSettingsOptions extends PoseStampedOptions {
  // Enable/disable flags for individual settings
  scaleEnabled?: boolean;
  colorEnabled?: boolean;
  arrowDimensionsEnabled?: boolean;
  trailEnabled?: boolean;
}

interface PoseStampedSettingsProps {
  vizId: string;
  topic: string;
  initialOptions?: Partial<PoseStampedSettingsOptions>;
  onClose: () => void;
  onSaveSettings: (vizId: string, newOptions: PoseStampedSettingsOptions) => void;
}

// SettingGroup component props
interface SettingGroupProps {
  title: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}

/**
 * SettingGroup - A component that renders a collapsible settings group with a toggle switch
 */
const SettingGroup = ({ 
  title, 
  enabled, 
  onToggle, 
  children
}: SettingGroupProps): JSX.Element => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="setting-group">
      <div className="setting-header">
        <button 
          type="button" 
          className="expand-toggle" 
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse section" : "Expand section"}
        >
          {expanded ? <FiChevronDown /> : <FiChevronRight />}
        </button>
        <label>{title}</label>
        <div className="toggle-switch-container">
          <label className="toggle-switch">
            <input 
              type="checkbox" 
              checked={enabled} 
              onChange={(e: ChangeEvent<HTMLInputElement>) => onToggle(e.target.checked)} 
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>
      {expanded && enabled && (
        <div className="setting-content">
          {children}
        </div>
      )}
    </div>
  );
};

const PoseStampedSettings: React.FC<PoseStampedSettingsProps> = ({
  vizId,
  topic,
  initialOptions,
  onClose,
  onSaveSettings,
}) => {
  // Merge initial options with defaults
  const defaultSettings: PoseStampedSettingsOptions = {
    visualizationType: 'arrow',
    scale: 1.0,
    color: '#00ff00',
    arrowLength: 1.0,
    arrowWidth: 0.1,
    axesSize: 0.5,
    showTrail: false,
    maxTrailLength: 50,
    // Default enable flags
    scaleEnabled: true,
    colorEnabled: true,
    arrowDimensionsEnabled: true,
    trailEnabled: false,
  };

  const [settings, setSettings] = useState<PoseStampedSettingsOptions>({
    ...defaultSettings,
    ...initialOptions,
  });

  // Update specific setting
  const updateSetting = <K extends keyof PoseStampedSettingsOptions>(
    key: K, 
    value: PoseStampedSettingsOptions[K]
  ) => {
    setSettings((prev: PoseStampedSettingsOptions) => ({
      ...prev,
      [key]: value
    }));
  };

  // Handle number input changes
  const handleNumberChange = (
    e: ChangeEvent<HTMLInputElement>, 
    key: keyof PoseStampedSettingsOptions
  ) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
      updateSetting(key, value);
    }
  };

  // Handle integer input changes
  const handleIntegerChange = (
    e: ChangeEvent<HTMLInputElement>, 
    key: keyof PoseStampedSettingsOptions
  ) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value)) {
      updateSetting(key, value);
    }
  };

  // Handle form submission
  const handleSave = () => {
    onSaveSettings(vizId, settings);
    onClose();
  };

  // Extract topic name for display
  const shortTopicName = topic.split('/').pop() || topic;

  return (
    <div className="topic-settings-popup">
      <div className="settings-popup-header">
        <h3>PoseStamped Settings: <span className="topic-name-display">{shortTopicName}</span></h3>
        <button className="close-button" onClick={onClose}>×</button>
      </div>
      <div className="settings-popup-content">
        <div className="settings-grid">
          
          {/* Visualization Type Setting */}
          <div className="setting-group basic-setting">
            <div className="setting-header">
              <label>Visualization Type</label>
            </div>
            <div className="setting-content">
              <div className="setting-control">
                <select
                  value={settings.visualizationType || 'arrow'}
                  onChange={(e) => updateSetting('visualizationType', e.target.value as 'arrow' | 'axes')}
                  className="dropdown-input"
                >
                  <option value="arrow">Arrow</option>
                  <option value="axes">Axes</option>
                </select>
              </div>
            </div>
          </div>

          {/* Scale Setting Group */}
          <SettingGroup 
            title="Scale" 
            enabled={settings.scaleEnabled || false}
            onToggle={(enabled) => updateSetting('scaleEnabled', enabled)}
          >
            <div className="setting-control">
              <input
                type="range"
                min="0.1" 
                max="5.0"
                step="0.1"
                value={settings.scale || 1.0}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'scale')}
              />
              <input
                type="number"
                min="0.1"
                max="5.0"
                step="0.1"
                value={settings.scale || 1.0}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'scale')}
                className="number-input"
              />
            </div>
          </SettingGroup>

          {/* Color Setting Group */}
          <SettingGroup 
            title="Color Settings" 
            enabled={settings.colorEnabled || false}
            onToggle={(enabled) => updateSetting('colorEnabled', enabled)}
          >
            <div className="color-container-wrapper">
              <label htmlFor="arrow-color">Color</label>
              <div className="color-container">
                <input
                  id="arrow-color"
                  type="color"
                  value={typeof settings.color === 'string' ? settings.color : '#00ff00'}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateSetting('color', e.target.value)}
                />
              </div>
            </div>
          </SettingGroup>

          {/* Arrow Dimensions Setting Group */}
          {settings.visualizationType === 'arrow' && (
            <SettingGroup 
              title="Arrow Dimensions" 
              enabled={settings.arrowDimensionsEnabled || false}
              onToggle={(enabled) => updateSetting('arrowDimensionsEnabled', enabled)}
            >
              <div className="setting-control">
                <label>Length</label>
                <input
                  type="range"
                  min="0.1" 
                  max="3.0"
                  step="0.1"
                  value={settings.arrowLength || 1.0}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'arrowLength')}
                />
                <input
                  type="number"
                  min="0.1"
                  max="3.0"
                  step="0.1"
                  value={settings.arrowLength || 1.0}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'arrowLength')}
                  className="number-input"
                />
              </div>
              <div className="setting-control">
                <label>Width</label>
                <input
                  type="range"
                  min="0.01" 
                  max="0.5"
                  step="0.01"
                  value={settings.arrowWidth || 0.1}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'arrowWidth')}
                />
                <input
                  type="number"
                  min="0.01"
                  max="0.5"
                  step="0.01"
                  value={settings.arrowWidth || 0.1}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'arrowWidth')}
                  className="number-input"
                />
              </div>
            </SettingGroup>
          )}

          {/* Axes Size Setting Group */}
          {settings.visualizationType === 'axes' && (
            <SettingGroup 
              title="Axes Size" 
              enabled={settings.arrowDimensionsEnabled || false}
              onToggle={(enabled) => updateSetting('arrowDimensionsEnabled', enabled)}
            >
              <div className="setting-control">
                <input
                  type="range"
                  min="0.1" 
                  max="2.0"
                  step="0.1"
                  value={settings.axesSize || 0.5}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'axesSize')}
                />
                <input
                  type="number"
                  min="0.1"
                  max="2.0"
                  step="0.1"
                  value={settings.axesSize || 0.5}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'axesSize')}
                  className="number-input"
                />
              </div>
            </SettingGroup>
          )}

          {/* Trail Setting Group */}
          <SettingGroup 
            title="Trail Visualization" 
            enabled={settings.trailEnabled || false}
            onToggle={(enabled) => {
              updateSetting('trailEnabled', enabled);
              updateSetting('showTrail', enabled);
            }}
          >
            <div className="setting-control">
              <label>Max Trail Length</label>
              <input
                type="range"
                min="5" 
                max="200"
                step="5"
                value={settings.maxTrailLength || 50}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleIntegerChange(e, 'maxTrailLength')}
              />
              <input
                type="number"
                min="5"
                max="200"
                step="5"
                value={settings.maxTrailLength || 50}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleIntegerChange(e, 'maxTrailLength')}
                className="number-input"
              />
            </div>
          </SettingGroup>

        </div>

        <div className="settings-actions">
          <button className="cancel-button" onClick={onClose}>Cancel</button>
          <button className="save-button" onClick={handleSave}>Apply</button>
        </div>
      </div>
    </div>
  );
};

export default PoseStampedSettings;
