import React, { useState, ChangeEvent } from 'react';
import { FiChevronDown, FiChevronRight } from 'react-icons/fi';
import './PointCloudSettings.css';

// Define the settings structure
export interface PointCloudSettingsOptions {
  pointSize: number;
  color: string;
  maxPoints?: number;
  // New toggle properties for enabling/disabling settings
  pointSizeEnabled: boolean;
  colorEnabled: boolean;
  maxPointsEnabled: boolean;
}

interface PointCloudSettingsProps {
  vizId: string;
  topic: string;
  initialOptions?: Partial<PointCloudSettingsOptions>;
  onClose: () => void;
  onSaveSettings: (vizId: string, newOptions: PointCloudSettingsOptions) => void;
}

const defaultSettings: PointCloudSettingsOptions = {
  pointSize: 0.05,
  color: '#00ff00',
  maxPoints: 200000,
  // Default all toggles to enabled
  pointSizeEnabled: true,
  colorEnabled: true,
  maxPointsEnabled: true,
};

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

/**
 * PointCloudSettings - A component for configuring point cloud visualization settings
 */
const PointCloudSettings = ({
  vizId,
  topic,
  initialOptions,
  onClose,
  onSaveSettings,
}: PointCloudSettingsProps): JSX.Element => {
  // Merge initial options with defaults
  const [settings, setSettings] = useState<PointCloudSettingsOptions>({
    ...defaultSettings,
    ...initialOptions
  });

  // Update specific setting
  const updateSetting = <K extends keyof PointCloudSettingsOptions>(
    key: K, 
    value: PointCloudSettingsOptions[K]
  ) => {
    setSettings((prev: PointCloudSettingsOptions) => ({
      ...prev,
      [key]: value
    }));
  };

  // Handle number input changes
  const handleNumberChange = (
    e: ChangeEvent<HTMLInputElement>, 
    key: keyof PointCloudSettingsOptions
  ) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
      updateSetting(key, value);
    }
  };

  // Handle save button
  const handleSave = () => {
    onSaveSettings(vizId, settings);
    onClose();
  };

  // Extract topic name for display
  const shortTopicName = topic.split('/').pop() || topic;

  return (
    <div className="point-cloud-settings-popup">
      <div className="settings-popup-header">
        <h3>Point Cloud Settings</h3>
        <button className="close-button" onClick={onClose}>×</button>
      </div>
      <div className="settings-popup-content">
        <div className="settings-grid">
          {/* Point Size Setting Group */}
          <SettingGroup 
            title="Point Size" 
            enabled={settings.pointSizeEnabled}
            onToggle={(enabled) => updateSetting('pointSizeEnabled', enabled)}
          >
            <div className="setting-control">
              <input
                id="point-size"
                type="range"
                min="0.01" 
                max="0.5"
                step="0.01"
                value={settings.pointSize}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'pointSize')}
              />
              <input
                type="number"
                min="0.01"
                max="0.5"
                step="0.01"
                value={settings.pointSize}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'pointSize')}
                className="number-input"
              />
            </div>
          </SettingGroup>

          {/* Max Points Setting Group */}
          <SettingGroup 
            title="Max Points" 
            enabled={settings.maxPointsEnabled}
            onToggle={(enabled) => updateSetting('maxPointsEnabled', enabled)}
          >
            <div className="setting-control">
              <input
                id="max-points"
                type="range"
                min="1000" 
                max="1000000"
                step="1000"
                value={settings.maxPoints}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'maxPoints')}
              />
              <input
                type="number"
                min="1000"
                max="1000000"
                step="1000"
                value={settings.maxPoints}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'maxPoints')}
                className="number-input"
              />
            </div>
          </SettingGroup>

          {/* Color Setting Group */}
          <SettingGroup 
            title="Color Settings" 
            enabled={settings.colorEnabled}
            onToggle={(enabled) => updateSetting('colorEnabled', enabled)}
          >
            <div className="color-container-wrapper">
              <label htmlFor="fixed-color">Color</label>
              <div className="color-container">
                <input
                  id="fixed-color"
                  type="color"
                  value={settings.color}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateSetting('color', e.target.value)}
                />
              </div>
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

export default PointCloudSettings; 