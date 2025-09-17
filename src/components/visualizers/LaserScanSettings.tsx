import React, { useState, ChangeEvent } from 'react';
import { LaserScanOptions } from './LaserScanViz'; 
import * as THREE from 'three';
import './TopicSettings.css'; 

export interface LaserScanSettingsOptions extends LaserScanOptions {
}

interface LaserScanSettingsProps {
  vizId: string;
  topic: string;
  initialOptions?: Partial<LaserScanSettingsOptions>;
  onClose: () => void;
  onSaveSettings: (vizId: string, newOptions: LaserScanSettingsOptions) => void;
}

const defaultLaserScanSettings: LaserScanSettingsOptions = {
  pointSize: 1.0,
  pointColor: '#0000ff', // Default blue
  minRange: 0.0,
  maxRange: 100.0,
};

// Helper to ensure color input value is a string
const getSafeColorString = (colorValue: string | THREE.Color | undefined, defaultColor: string): string => {
  if (typeof colorValue === 'string') {
    return colorValue;
  }
  if (colorValue instanceof THREE.Color) {
    return '#' + colorValue.getHexString();
  }
  return defaultColor;
};

const LaserScanSettings: React.FC<LaserScanSettingsProps> = ({
  vizId,
  topic,
  initialOptions,
  onClose,
  onSaveSettings,
}) => {
  const [settings, setSettings] = useState<LaserScanSettingsOptions>(() => {
    const initialPointColor = initialOptions?.pointColor;
    const safeInitialColor = getSafeColorString(initialPointColor, defaultLaserScanSettings.pointColor as string);
    return {
      ...defaultLaserScanSettings,
      ...initialOptions,
      pointColor: safeInitialColor, // Ensures pointColor in state is always string
    };
  });

  const handleInputChange = <K extends keyof LaserScanSettingsOptions>(
    key: K,
    value: LaserScanSettingsOptions[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleNumberChange = <K extends keyof LaserScanSettingsOptions>(
    e: ChangeEvent<HTMLInputElement>,
    key: K 
  ) => {
    const stringValue = e.target.value;
    if (stringValue === '') {
      handleInputChange(key, undefined as unknown as LaserScanSettingsOptions[K]); 
      return;
    }
    const value = parseFloat(stringValue);
    if (!isNaN(value)) {
      handleInputChange(key, value as unknown as LaserScanSettingsOptions[K]);
    }
  };
  
  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleInputChange('pointSize', parseFloat(e.target.value) as LaserScanSettingsOptions['pointSize']);
  };

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    // e.target.value from color input is always a string
    handleInputChange('pointColor', e.target.value as string as LaserScanSettingsOptions['pointColor']);
  };

  const handleSave = () => {
    const finalSettings = {
        ...settings,
        // Ensure pointColor is a string for saving, consistent with state management.
        // If LaserScanViz expects THREE.Color, it should handle the conversion.
        pointColor: settings.pointColor as string 
    };
    onSaveSettings(vizId, finalSettings as LaserScanSettingsOptions);
    onClose();
  };

  const shortTopicName = topic.split('/').pop() || topic;

  return (
    <div className="topic-settings-popup settings-popup-style"> 
      <div className="settings-popup-header">
        <h3>LaserScan Settings: <span className="topic-name-display">{shortTopicName}</span></h3>
        <button onClick={onClose} className="close-button icon-button" aria-label="Close settings">
          &times;
        </button>
      </div>
      <div className="settings-popup-content">
        <div className="popup-control-item">
          <label htmlFor={`ls-pointSize-${vizId}`}>Point Size: {settings.pointSize?.toFixed(2)}</label>
          <input
            type="range" 
            id={`ls-pointSize-${vizId}`}
            value={settings.pointSize || 1.0}
            onChange={handleSliderChange} 
            step="0.01" 
            min="0.5"
            max="5.0"   
            className="range-input" 
          />
        </div>

        <div className="popup-control-item">
          <label htmlFor={`ls-pointColor-${vizId}`}>Point Color:</label>
          <input
            type="color"
            id={`ls-pointColor-${vizId}`}
            value={settings.pointColor as string} // State's pointColor is managed as string
            onChange={handleColorChange}
          />
        </div>

        <div className="popup-control-item">
          <label htmlFor={`ls-minRange-${vizId}`}>Min Range (m):</label>
          <input
            type="number"
            id={`ls-minRange-${vizId}`}
            value={settings.minRange ?? ''} 
            onChange={(e) => handleNumberChange(e, 'minRange')}
            step="0.1"
            placeholder="e.g., 0.0"
          />
        </div>

        <div className="popup-control-item">
          <label htmlFor={`ls-maxRange-${vizId}`}>Max Range (m):</label>
          <input
            type="number"
            id={`ls-maxRange-${vizId}`}
            value={settings.maxRange ?? ''} 
            onChange={(e) => handleNumberChange(e, 'maxRange')}
            step="0.1"
            placeholder="e.g., 100.0"
          />
        </div>

      </div>
      <div className="settings-popup-actions">
        <button onClick={handleSave} className="save-settings-button">Save & Close</button>
        <button onClick={onClose} className="cancel-button">Cancel</button>
      </div>
    </div>
  );
};

export default LaserScanSettings;
