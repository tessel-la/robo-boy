import React, { useState } from 'react';

/** A size, in scene metres unless another unit is given. The slider is logarithmic so the small
 * end (a few centimetres for a desktop robot) has as much travel as the large end, and the number
 * next to it is typed into directly for an exact value. */
const ScaleField: React.FC<{
  id: string;
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  precision?: number;
  unit?: string;
  onChange: (value: number) => void;
}> = ({ id, label, ariaLabel, value, min, max, disabled, precision = 2, unit = 'm', onChange }) => {
  const SLIDER_STEPS = 1000;
  const toSlider = (metres: number) =>
    Math.round((Math.log(Math.min(Math.max(metres, min), max) / min) / Math.log(max / min)) * SLIDER_STEPS);
  const fromSlider = (position: number) => min * Math.pow(max / min, position / SLIDER_STEPS);
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed) && parsed > 0) onChange(Math.min(Math.max(parsed, min), max));
    setDraft(null);
  };

  return (
    <div className="scale-field">
      <div className="control-heading-row">
        <label htmlFor={id}>{label}</label>
        <span className="scale-field-value">
          <input
            type="number"
            className="scale-field-number"
            aria-label={ariaLabel ?? (unit === 'm' ? `${label} in metres` : `${label} in ${unit}`)}
            min={min}
            max={max}
            step={10 ** -precision}
            disabled={disabled}
            value={draft ?? value.toFixed(precision)}
            onChange={event => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') commitDraft();
            }}
          />
          {unit && <span>{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        id={id}
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={toSlider(value)}
        disabled={disabled}
        onChange={event => onChange(Number(fromSlider(Number(event.target.value)).toFixed(3)))}
        className="range-input"
      />
    </div>
  );
};

export default ScaleField;
