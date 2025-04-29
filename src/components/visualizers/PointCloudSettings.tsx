import React, { useState, ChangeEvent } from 'react';
import { FiX } from 'react-icons/fi';
import './PointCloudSettings.css';

// Define the settings structure
export interface PointCloudSettingsOptions {
  pointSize: number;
  color: string;
  colorAxis?: 'x' | 'y' | 'z' | 'none';
  minAxisValue?: number;
  maxAxisValue?: number;
  minColor?: string;
  maxColor?: string;
  maxPoints?: number;
  isCompactView: boolean;
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
  colorAxis: 'none',
  minAxisValue: -5,
  maxAxisValue: 5,
  minColor: '#0000ff',
  maxColor: '#ff0000',
  maxPoints: 200000,
  isCompactView: false,
};

const PointCloudSettings: React.FC<PointCloudSettingsProps> = ({
  vizId,
  topic,
  initialOptions,
  onClose,
  onSaveSettings,
}) => {
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
        <div className="setting-group">
          <div className="setting-item">
            <label>Compact View</label>
            <div className="setting-input">
              <input 
                type="checkbox" 
                checked={settings.isCompactView} 
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateSetting('isCompactView', e.target.checked)}
              />
            </div>
          </div>
        </div>
        
        <div className="settings-columns">
          {/* Point Size Setting */}
          <div className={`setting-group ${settings.isCompactView ? 'compact' : ''}`}>
            <label htmlFor="point-size">Point Size</label>
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
          </div>

          {/* Max Points Setting */}
          <div className={`setting-group ${settings.isCompactView ? 'compact' : ''}`}>
            <label htmlFor="max-points">Max Points</label>
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
          </div>

          {/* Color Method Setting */}
          <div className={`setting-group ${settings.isCompactView ? 'compact' : ''}`}>
            <label htmlFor="color-axis">Color By</label>
            <select
              id="color-axis"
              value={settings.colorAxis}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => updateSetting('colorAxis', e.target.value as 'x' | 'y' | 'z' | 'none')}
              className="color-method-select"
            >
              <option value="none">Fixed Color</option>
              <option value="x">X Axis</option>
              <option value="y">Y Axis</option>
              <option value="z">Z Axis</option>
            </select>
          </div>

          {/* Fixed Color Setting */}
          {settings.colorAxis === 'none' && (
            <div className={`setting-group ${settings.isCompactView ? 'compact' : ''}`}>
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
          )}

          {/* Axis Range Settings */}
          {settings.colorAxis !== 'none' && (
            <>
              <div className={`setting-group ${settings.isCompactView ? 'compact' : ''}`}>
                <label>{settings.colorAxis.toUpperCase()} Range</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    value={settings.minAxisValue}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'minAxisValue')}
                    className="number-input"
                  />
                  <span>to</span>
                  <input
                    type="number"
                    value={settings.maxAxisValue}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleNumberChange(e, 'maxAxisValue')}
                    className="number-input"
                  />
                </div>
              </div>

              <div className={`setting-group ${settings.isCompactView ? 'compact' : ''}`}>
                <label>Color Range</label>
                <div className="color-inputs">
                  <input
                    type="color"
                    value={settings.minColor}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateSetting('minColor', e.target.value)}
                    title="Min value color"
                  />
                  <div 
                    className="gradient-preview"
                    style={{
                      background: `linear-gradient(to right, ${settings.minColor}, ${settings.maxColor})`
                    }}
                  ></div>
                  <input
                    type="color"
                    value={settings.maxColor}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateSetting('maxColor', e.target.value)}
                    title="Max value color"
                  />
                </div>
              </div>
            </>
          )}
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