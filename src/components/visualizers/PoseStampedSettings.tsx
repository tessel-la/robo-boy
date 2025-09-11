import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { PoseStampedOptions } from '../../hooks/usePoseStampedClient';
import './PoseStampedSettings.css';

export interface PoseStampedSettingsOptions extends PoseStampedOptions {}

interface PoseStampedSettingsProps {
  options: PoseStampedSettingsOptions;
  onOptionsChange: (newOptions: PoseStampedSettingsOptions) => void;
}

const PoseStampedSettings: React.FC<PoseStampedSettingsProps> = ({
  options,
  onOptionsChange,
}) => {
  // Local state for form inputs
  const [visualizationType, setVisualizationType] = useState<'arrow' | 'axes'>(
    options.visualizationType || 'arrow'
  );
  const [scale, setScale] = useState<number>(options.scale || 1.0);
  const [color, setColor] = useState<string>(
    typeof options.color === 'string' 
      ? options.color 
      : options.color instanceof THREE.Color 
        ? `#${options.color.getHexString()}` 
        : '#00ff00'
  );
  const [arrowLength, setArrowLength] = useState<number>(options.arrowLength || 1.0);
  const [arrowWidth, setArrowWidth] = useState<number>(options.arrowWidth || 0.1);
  const [axesSize, setAxesSize] = useState<number>(options.axesSize || 0.5);
  const [showTrail, setShowTrail] = useState<boolean>(options.showTrail || false);
  const [maxTrailLength, setMaxTrailLength] = useState<number>(options.maxTrailLength || 50);

  // Update local state when options prop changes
  useEffect(() => {
    setVisualizationType(options.visualizationType || 'arrow');
    setScale(options.scale || 1.0);
    setColor(
      typeof options.color === 'string' 
        ? options.color 
        : options.color instanceof THREE.Color 
          ? `#${options.color.getHexString()}` 
          : '#00ff00'
    );
    setArrowLength(options.arrowLength || 1.0);
    setArrowWidth(options.arrowWidth || 0.1);
    setAxesSize(options.axesSize || 0.5);
    setShowTrail(options.showTrail || false);
    setMaxTrailLength(options.maxTrailLength || 50);
  }, [options]);

  // Handle form submission
  const handleApply = () => {
    const newOptions: PoseStampedSettingsOptions = {
      visualizationType,
      scale,
      color,
      arrowLength,
      arrowWidth,
      axesSize,
      showTrail,
      maxTrailLength,
    };
    onOptionsChange(newOptions);
  };

  return (
    <div className="pose-stamped-settings">
      <h3>PoseStamped Visualization Settings</h3>
      
      <div className="setting-group">
        <label htmlFor="visualization-type">Visualization Type:</label>
        <select
          id="visualization-type"
          value={visualizationType}
          onChange={(e) => setVisualizationType(e.target.value as 'arrow' | 'axes')}
        >
          <option value="arrow">Arrow</option>
          <option value="axes">Axes</option>
        </select>
      </div>

      <div className="setting-group">
        <label htmlFor="scale">Scale:</label>
        <input
          id="scale"
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          value={scale}
          onChange={(e) => setScale(parseFloat(e.target.value) || 1.0)}
        />
      </div>

      <div className="setting-group">
        <label htmlFor="color">Color:</label>
        <input
          id="color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>

      {visualizationType === 'arrow' && (
        <>
          <div className="setting-group">
            <label htmlFor="arrow-length">Arrow Length:</label>
            <input
              id="arrow-length"
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={arrowLength}
              onChange={(e) => setArrowLength(parseFloat(e.target.value) || 1.0)}
            />
          </div>

          <div className="setting-group">
            <label htmlFor="arrow-width">Arrow Width:</label>
            <input
              id="arrow-width"
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              value={arrowWidth}
              onChange={(e) => setArrowWidth(parseFloat(e.target.value) || 0.1)}
            />
          </div>
        </>
      )}

      {visualizationType === 'axes' && (
        <div className="setting-group">
          <label htmlFor="axes-size">Axes Size:</label>
          <input
            id="axes-size"
            type="number"
            min="0.1"
            max="3"
            step="0.1"
            value={axesSize}
            onChange={(e) => setAxesSize(parseFloat(e.target.value) || 0.5)}
          />
        </div>
      )}

      <div className="setting-group">
        <label htmlFor="show-trail">
          <input
            id="show-trail"
            type="checkbox"
            checked={showTrail}
            onChange={(e) => setShowTrail(e.target.checked)}
          />
          Show Trail
        </label>
      </div>

      {showTrail && (
        <div className="setting-group">
          <label htmlFor="max-trail-length">Max Trail Length:</label>
          <input
            id="max-trail-length"
            type="number"
            min="5"
            max="200"
            step="5"
            value={maxTrailLength}
            onChange={(e) => setMaxTrailLength(parseInt(e.target.value) || 50)}
          />
        </div>
      )}

      <div className="setting-actions">
        <button onClick={handleApply} className="apply-button">
          Apply Settings
        </button>
      </div>
    </div>
  );
};

export default PoseStampedSettings;
