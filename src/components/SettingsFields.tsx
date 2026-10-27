import React, { useState } from 'react';

/** The 3D view menu's controls. Every layer and the frame display build from these, so a
 * switch, a list, a colour or a value looks and behaves the same wherever it appears. */

/** A labelled switch row: the label on the left, the checkbox on the right, the whole row clickable. */
export const ToggleRow: React.FC<{
  label: string;
  ariaLabel?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, ariaLabel, checked, disabled, onChange }) => (
  <label className={`settings-toggle-row${disabled ? ' is-disabled' : ''}`}>
    <span>{label}</span>
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={event => onChange(event.target.checked)}
    />
  </label>
);

/** A labelled drop-down with the menu's chevron. */
export const SelectField: React.FC<{
  id: string;
  label: string;
  ariaLabel?: string;
  value: string;
  disabled?: boolean;
  title?: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ id, label, ariaLabel, value, disabled, title, onChange, children }) => (
  <div className="settings-field">
    <label className="viz-topic-label" htmlFor={id}>
      {label}
    </label>
    <div className="topic-dropdown-container">
      <select
        id={id}
        className="topic-dropdown"
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        title={title}
        onChange={event => onChange(event.target.value)}
      >
        {children}
      </select>
    </div>
  </div>
);

/** A labelled line of text, committed on blur or Enter. */
export const TextField: React.FC<{
  id: string;
  label: string;
  ariaLabel?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}> = ({ id, label, ariaLabel, value, placeholder, onChange }) => (
  <div className="settings-field">
    <label className="viz-topic-label" htmlFor={id}>
      {label}
    </label>
    <input
      key={value}
      id={id}
      type="text"
      className="settings-text-input"
      aria-label={ariaLabel}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={event => {
        const next = event.currentTarget.value.trim();
        if (next !== value) onChange(next);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  </div>
);

/** A label with a colour swatch that opens the system picker. */
export const ColorField: React.FC<{
  id: string;
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ id, label, ariaLabel, value, onChange }) => (
  <div className="control-heading-row settings-inline-row">
    <label htmlFor={id}>{label}</label>
    <input
      type="color"
      id={id}
      className="settings-color-input"
      aria-label={ariaLabel}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  </div>
);

/** An opacity or other 0–1 fraction, shown as a percentage. */
export const PercentField: React.FC<{
  id: string;
  label: string;
  ariaLabel?: string;
  value: number;
  min?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, ariaLabel, value, min = 0, disabled, onChange }) => (
  <div className="settings-slider-field">
    <div className="control-heading-row">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id} className="range-value">
        {Math.round(value * 100)}%
      </output>
    </div>
    <input
      type="range"
      id={id}
      className="range-input"
      aria-label={ariaLabel}
      min={min}
      max="1"
      step="0.05"
      value={value}
      disabled={disabled}
      onChange={event => onChange(Number(event.target.value))}
    />
  </div>
);

/** A typed value with its unit, committed on blur or Enter and clamped to its range. */
export const NumberField: React.FC<{
  id: string;
  label: string;
  ariaLabel?: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, ariaLabel, value, unit, min, max, step = 1, disabled, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) onChange(Math.min(Math.max(parsed, min), max));
    setDraft(null);
  };
  return (
    <div className="control-heading-row settings-inline-row">
      <label htmlFor={id}>{label}</label>
      <span className="scale-field-value">
        <input
          type="number"
          id={id}
          className="scale-field-number"
          aria-label={ariaLabel}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={draft ?? value}
          onChange={event => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter') commitDraft();
          }}
        />
        {unit && <span>{unit}</span>}
      </span>
    </div>
  );
};
