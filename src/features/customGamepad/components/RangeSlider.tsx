import React, { useState, useCallback, useEffect } from 'react';
import { getStepPrecision, roundToStepPrecision } from '../rangeUtils';
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
  const precision = getStepPrecision(step);
  const [minInput, setMinInput] = useState(minValue.toFixed(precision));
  const [maxInput, setMaxInput] = useState(maxValue.toFixed(precision));

  useEffect(() => {
    setMinVal(minValue);
    setMaxVal(maxValue);
  }, [minValue, maxValue]);

  useEffect(() => {
    setMinInput(minVal.toFixed(precision));
    setMaxInput(maxVal.toFixed(precision));
  }, [maxVal, minVal, precision]);

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

  const commitMinInput = useCallback(() => {
    const parsed = Number(minInput);
    if (!Number.isFinite(parsed)) {
      setMinInput(minVal.toFixed(precision));
      return;
    }

    const value = roundToStepPrecision(
      Math.max(min, Math.min(parsed, maxVal - step)),
      step
    );
    setMinVal(value);
    setMinInput(value.toFixed(precision));
    onChange({ min: value, max: maxVal });
  }, [maxVal, min, minInput, minVal, onChange, precision, step]);

  const commitMaxInput = useCallback(() => {
    const parsed = Number(maxInput);
    if (!Number.isFinite(parsed)) {
      setMaxInput(maxVal.toFixed(precision));
      return;
    }

    const value = roundToStepPrecision(
      Math.min(max, Math.max(parsed, minVal + step)),
      step
    );
    setMaxVal(value);
    setMaxInput(value.toFixed(precision));
    onChange({ min: minVal, max: value });
  }, [max, maxInput, maxVal, minVal, onChange, precision, step]);

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    currentValue: number,
    resetInput: (value: string) => void,
    commitInput: () => void
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitInput();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      resetInput(currentValue.toFixed(precision));
    }
  };

  const range = max - min;
  const minPos = range === 0 ? 0 : ((minVal - min) / range) * 100;
  const maxPos = range === 0 ? 0 : ((maxVal - min) / range) * 100;

  return (
    <div className="range-slider-container">
      <div className="range-slider-values">
        <input
          type="number"
          aria-label="Selected range minimum"
          min={min}
          max={maxVal - step}
          step={step}
          value={minInput}
          onChange={(event) => setMinInput(event.target.value)}
          onBlur={commitMinInput}
          onKeyDown={(event) => handleInputKeyDown(
            event,
            minVal,
            setMinInput,
            commitMinInput
          )}
          className="range-slider-value-input"
        />
        <input
          type="number"
          aria-label="Selected range maximum"
          min={minVal + step}
          max={max}
          step={step}
          value={maxInput}
          onChange={(event) => setMaxInput(event.target.value)}
          onBlur={commitMaxInput}
          onKeyDown={(event) => handleInputKeyDown(
            event,
            maxVal,
            setMaxInput,
            commitMaxInput
          )}
          className="range-slider-value-input range-slider-value-input-right"
        />
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
