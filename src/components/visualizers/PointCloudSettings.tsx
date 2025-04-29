import React, { useState, useEffect } from 'react';
import { FiX } from 'react-icons/fi';

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
  maxPoints: 200000
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
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Handle number input changes
  const handleNumberChange = (
    e: React.ChangeEvent<HTMLInputElement>, 
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

  return (
    <div className="point-cloud-settings-popup">
      <div className="settings-popup-header">
        <h3>Point Cloud Settings: {topic}</h3>
        <button onClick={onClose} className="close-button icon-button" aria-label="Close settings">
          <FiX />
        </button>
      </div>

      <div className="settings-popup-content">
        {/* Point Size */}
        <div className="setting-group">
          <label htmlFor="point-size">Point Size:</label>
          <div className="setting-control">
            <input
              id="point-size"
              type="range"
              min="0.01" 
              max="0.5"
              step="0.01"
              value={settings.pointSize}
              onChange={(e) => handleNumberChange(e, 'pointSize')}
            />
            <input
              type="number"
              min="0.01"
              max="0.5"
              step="0.01"
              value={settings.pointSize}
              onChange={(e) => handleNumberChange(e, 'pointSize')}
              className="number-input"
            />
          </div>
        </div>

        {/* Max Points */}
        <div className="setting-group">
          <label htmlFor="max-points">Max Points:</label>
          <div className="setting-control">
            <input
              id="max-points"
              type="range"
              min="1000" 
              max="1000000"
              step="1000"
              value={settings.maxPoints}
              onChange={(e) => handleNumberChange(e, 'maxPoints')}
            />
            <input
              type="number"
              min="1000"
              max="1000000"
              step="1000"
              value={settings.maxPoints}
              onChange={(e) => handleNumberChange(e, 'maxPoints')}
              className="number-input"
            />
          </div>
        </div>

        {/* Color Method */}
        <div className="setting-group">
          <label htmlFor="color-axis">Color By:</label>
          <select
            id="color-axis"
            value={settings.colorAxis}
            onChange={(e) => updateSetting('colorAxis', e.target.value as 'x' | 'y' | 'z' | 'none')}
          >
            <option value="none">Fixed Color</option>
            <option value="x">X Axis</option>
            <option value="y">Y Axis</option>
            <option value="z">Z Axis</option>
          </select>
        </div>

        {/* Fixed Color (shown only when colorAxis is 'none') */}
        {settings.colorAxis === 'none' && (
          <div className="setting-group">
            <label htmlFor="fixed-color">Color:</label>
            <input
              id="fixed-color"
              type="color"
              value={settings.color}
              onChange={(e) => updateSetting('color', e.target.value)}
            />
          </div>
        )}

        {/* Axis Color Range (shown only when colorAxis is not 'none') */}
        {settings.colorAxis !== 'none' && (
          <>
            <div className="setting-group axis-range">
              <label>Axis Range:</label>
              <div className="range-inputs">
                <input
                  type="number"
                  value={settings.minAxisValue}
                  onChange={(e) => handleNumberChange(e, 'minAxisValue')}
                  className="number-input"
                />
                <span>to</span>
                <input
                  type="number"
                  value={settings.maxAxisValue}
                  onChange={(e) => handleNumberChange(e, 'maxAxisValue')}
                  className="number-input"
                />
              </div>
            </div>

            <div className="setting-group color-gradient">
              <label>Color Range:</label>
              <div className="color-inputs">
                <input
                  type="color"
                  value={settings.minColor}
                  onChange={(e) => updateSetting('minColor', e.target.value)}
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
                  onChange={(e) => updateSetting('maxColor', e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        <div className="settings-actions">
          <button className="cancel-button" onClick={onClose}>Cancel</button>
          <button className="save-button" onClick={handleSave}>Apply</button>
        </div>
      </div>
    </div>
  );
};

export default PointCloudSettings; 