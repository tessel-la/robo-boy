import React, { useState, useCallback, useEffect } from 'react';
import './RangeSlider.css';

interface RangeSliderProps {
  min: number;
  max: number;
  step: number;
  minValue: number;
  maxValue: number;
  onChange: ({ min, max }: { min: number; max: number }) => void;
}

const RangeSlider: React.FC<RangeSliderProps> = ({ min, max, step, minValue, maxValue, onChange }) => {
  const [minVal, setMinVal] = useState(minValue);
  const [maxVal, setMaxVal] = useState(maxValue);

  useEffect(() => {
    setMinVal(minValue);
    setMaxVal(maxValue);
  }, [minValue, maxValue]);

  // Clamp values when min/max boundaries change
  useEffect(() => {
    let needsUpdate = false;
    let newMinVal = minVal;
    let newMaxVal = maxVal;

    // Clamp minVal to new boundaries
    if (minVal < min) {
      newMinVal = min;
      needsUpdate = true;
    } else if (minVal > max) {
      newMinVal = max - step;
      needsUpdate = true;
    }

    // Clamp maxVal to new boundaries
    if (maxVal > max) {
      newMaxVal = max;
      needsUpdate = true;
    } else if (maxVal < min) {
      newMaxVal = min + step;
      needsUpdate = true;
    }

    // Ensure minVal and maxVal maintain proper relationship
    if (newMinVal >= newMaxVal) {
      if (newMinVal === max) {
        newMinVal = max - step;
      } else {
        newMaxVal = newMinVal + step;
      }
      needsUpdate = true;
    }

    // Update values and notify parent if changes occurred
    if (needsUpdate) {
      setMinVal(newMinVal);
      setMaxVal(newMaxVal);
      onChange({ min: newMinVal, max: newMaxVal });
    }
  }, [min, max, step, minVal, maxVal, onChange]);

  const handleMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.min(Number(e.target.value), maxVal - step);
    setMinVal(value);
    onChange({ min: value, max: maxVal });
  }, [maxVal, step, onChange]);

  const handleMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(Number(e.target.value), minVal + step);
    setMaxVal(value);
    onChange({ min: minVal, max: value });
  }, [minVal, step, onChange]);

  const range = max - min;
  const minPos = range === 0 ? 0 : ((minVal - min) / range) * 100;
  const maxPos = range === 0 ? 0 : ((maxVal - min) / range) * 100;

  return (
    <div className="range-slider-container">
      <div className="range-slider-values">
        <span>{minVal.toFixed(step < 1 ? 2 : 0)}</span>
        <span>{maxVal.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <div className="range-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={minVal}
          onChange={handleMinChange}
          className="thumb thumb-left"
          style={{ zIndex: minVal > max - step ? 5 : 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={maxVal}
          onChange={handleMaxChange}
          className="thumb thumb-right"
        />
        <div className="slider-track" />
        <div className="slider-range" style={{ left: `${minPos}%`, right: `${100 - maxPos}%` }} />
      </div>
    </div>
  );
};

export default RangeSlider; 