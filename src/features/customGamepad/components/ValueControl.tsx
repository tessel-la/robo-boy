import React, { useState, useEffect } from 'react';
import { getStepPrecision } from '../rangeUtils';
import './ValueControl.css';

interface ValueControlProps {
  label: string;
  value: number;
  onChange: (newValue: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

const ValueControl: React.FC<ValueControlProps> = ({
  label,
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
}) => {
  const precision = getStepPrecision(step);
  const [inputValue, setInputValue] = useState(value.toFixed(precision));

  useEffect(() => {
    setInputValue(value.toFixed(precision));
  }, [value, precision]);

  const commitChange = (val: number) => {
    const clampedValue = Math.max(min, Math.min(max, val));
    const roundedValue = parseFloat(clampedValue.toFixed(precision));
    
    if (roundedValue !== value) {
      onChange(roundedValue);
    } else {
      // If value didn't change, re-format the input to ensure consistency
      setInputValue(roundedValue.toFixed(precision));
    }
  };

  const handleIncrement = () => {
    commitChange(value + step);
  };

  const handleDecrement = () => {
    commitChange(value - step);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleBlur = () => {
    const newValue = parseFloat(inputValue);
    commitChange(isNaN(newValue) ? value : newValue);
  };

  return (
    <div className="value-control">
      <label>{label}</label>
      <div className="control-input-group">
        <button
          className="control-btn minus"
          onClick={handleDecrement}
          disabled={value <= min}
          title={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          step={step}
          className="control-value-input"
        />
        <button
          className="control-btn plus"
          onClick={handleIncrement}
          disabled={value >= max}
          title={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
};

export default ValueControl;
