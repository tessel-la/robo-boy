import React, { useEffect, useId, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import type { GamepadComponentConfig } from '../types';
import type { DataComponentType } from '../dataComponents';
import type { FieldKind } from '../rosMessageUtils';
import { STATE_TONES, type StateMapping, type StateTone } from '../padValues';
import { getDynamicRangeStep } from '../rangeUtils';
import { DEFAULT_TEXT_HISTORY } from './TextComponent';
import ValueControl from './ValueControl';

export type ValueConfig = Pick<
  NonNullable<GamepadComponentConfig['config']>,
  | 'min' | 'max' | 'step' | 'orientation' | 'unit' | 'decimals' | 'scale' | 'offset' | 'warnAt' | 'alarmAt'
  | 'alertBelow' | 'staleAfterMs' | 'stateMappings' | 'historyLength' | 'sendOnChange'
>;

export const VALUE_CONFIG_KEYS: readonly (keyof ValueConfig)[] = [
  'min', 'max', 'step', 'orientation', 'unit', 'decimals', 'scale', 'offset', 'warnAt', 'alarmAt', 'alertBelow',
  'staleAfterMs', 'stateMappings', 'historyLength', 'sendOnChange',
];

/** The settings of these kinds that a component of this type uses; the others are left out when it is saved. */
export function valueConfigFor(type: DataComponentType, config: ValueConfig): ValueConfig {
  const numeric = type === 'gauge' || type === 'level' || type === 'readout';
  const keep: Record<keyof ValueConfig, boolean> = {
    min: type === 'gauge' || type === 'level' || type === 'setpoint',
    max: type === 'gauge' || type === 'level' || type === 'setpoint',
    step: type === 'setpoint',
    orientation: type === 'level',
    unit: numeric || type === 'setpoint',
    decimals: numeric || type === 'setpoint',
    scale: numeric,
    offset: numeric,
    warnAt: numeric,
    alarmAt: numeric,
    alertBelow: numeric,
    staleAfterMs: type !== 'setpoint',
    stateMappings: type === 'state',
    historyLength: type === 'text',
    sendOnChange: type === 'setpoint',
  };
  return Object.fromEntries(
    VALUE_CONFIG_KEYS.map(key => [key, keep[key] ? config[key] : undefined])
  ) as ValueConfig;
}

const TONE_LABELS: Record<StateTone, string> = { ok: 'OK (green)', info: 'Info (blue)', warning: 'Warning (amber)', error: 'Error (red)', neutral: 'Neutral (grey)' };

interface NumberFieldProps {
  id?: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  help?: string;
}

/** A number that may be left empty (for "none"), typed freely and kept while it is still being written. */
const NumberField: React.FC<NumberFieldProps> = ({ id, label, value, onChange, placeholder, help }) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  // Follow changes made elsewhere, but keep what is being typed ("0.", "-") while it means the same value.
  useEffect(() => {
    setDraft(current => {
      const typed = current.trim() === '' ? undefined : Number(current);
      return typed === value ? current : value === undefined ? '' : String(value);
    });
  }, [value]);
  return (
    <div className="setting-group">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        step="any"
        value={draft}
        placeholder={placeholder}
        className="setting-input"
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === '') onChange(undefined);
          else if (Number.isFinite(Number(text))) onChange(Number(text));
        }}
      />
      {help && <small className="axis-help-text">{help}</small>}
    </div>
  );
};

interface ValueSettingsProps {
  type: DataComponentType;
  value: ValueConfig;
  onChange: (patch: Partial<ValueConfig>) => void;
  /** The primitive type of the chosen field, when known: integers step by whole numbers. */
  fieldType?: string;
  fieldKind?: FieldKind;
}

/** The settings a value component adds to its topic: range, units and format, alerts, states, history. */
const ValueSettings: React.FC<ValueSettingsProps> = ({ type, value, onChange, fieldType, fieldKind }) => {
  const isNumeric = type === 'gauge' || type === 'level' || type === 'readout';
  const hasRange = type === 'gauge' || type === 'level' || type === 'setpoint';
  const min = value.min ?? 0;
  const max = value.max ?? 100;
  const isInteger = /^u?int|^byte$|^char$/.test(fieldType ?? '');
  const rangeStep = getDynamicRangeStep(min, max, isInteger && type === 'setpoint');
  const mappings = value.stateMappings ?? [];
  const setMapping = (index: number, patch: Partial<StateMapping>) =>
    onChange({ stateMappings: mappings.map((mapping, i) => (i === index ? { ...mapping, ...patch } : mapping)) });

  return (
    <>
      {(hasRange || isNumeric) && (
        <div className="settings-section">
          <h4>{type === 'setpoint' ? 'Command range' : 'Range and display'}</h4>

          {hasRange && (
            <div className="setting-group range-controls">
              <ValueControl label="Minimum value" value={min} onChange={next => onChange({ min: next })} step={rangeStep} max={max} />
              <ValueControl label="Maximum value" value={max} onChange={next => onChange({ max: next })} step={rangeStep} min={min} />
            </div>
          )}

          <div className="setting-group">
            <label htmlFor="value-unit">Unit</label>
            <input
              id="value-unit"
              type="text"
              value={value.unit ?? ''}
              onChange={(event) => onChange({ unit: event.target.value || undefined })}
              placeholder="e.g. %, V, °C, m/s"
              className="setting-input"
              maxLength={12}
            />
          </div>

          <div className="setting-group">
            <label htmlFor="value-decimals">Decimals</label>
            <select
              id="value-decimals"
              value={value.decimals ?? ''}
              onChange={(event) => onChange({ decimals: event.target.value === '' ? undefined : Number(event.target.value) })}
              className="setting-select"
            >
              <option value="">Automatic</option>
              {[0, 1, 2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count}</option>)}
            </select>
          </div>

          {type === 'level' && (
            <div className="setting-group">
              <label htmlFor="value-orientation">Orientation</label>
              <select
                id="value-orientation"
                value={value.orientation ?? ''}
                onChange={(event) => onChange({ orientation: (event.target.value || undefined) as ValueConfig['orientation'] })}
                className="setting-select"
              >
                <option value="">Follow the component's shape</option>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </div>
          )}

          {type === 'setpoint' && (
            <div className="setting-group range-controls">
              <ValueControl
                label="Step size"
                value={value.step ?? rangeStep}
                onChange={next => onChange({ step: next })}
                step={isInteger ? 1 : rangeStep}
                min={isInteger ? 1 : rangeStep}
              />
            </div>
          )}

          {isNumeric && (
            <>
              <NumberField
                id="value-scale"
                label="Scale"
                value={value.scale}
                placeholder="1"
                onChange={scale => onChange({ scale })}
              />
              <NumberField
                id="value-offset"
                label="Offset"
                value={value.offset}
                placeholder="0"
                onChange={offset => onChange({ offset })}
              />
              <small className="axis-help-text">
                Shown value = field value × scale + offset. A scale of 100 turns a 0–1 battery fraction into percent.
                The range and thresholds are in shown units.
              </small>
            </>
          )}
        </div>
      )}

      {isNumeric && (
        <div className="settings-section">
          <h4>Alerts</h4>
          <NumberField id="value-warn" label="Warning at" value={value.warnAt} placeholder="None" onChange={warnAt => onChange({ warnAt })} />
          <NumberField id="value-alarm" label="Alarm at" value={value.alarmAt} placeholder="None" onChange={alarmAt => onChange({ alarmAt })} />
          <div className="setting-group">
            <label htmlFor="value-alert-direction">Alert on</label>
            <select
              id="value-alert-direction"
              value={value.alertBelow ? 'below' : 'above'}
              onChange={(event) => onChange({ alertBelow: event.target.value === 'below' || undefined })}
              className="setting-select"
            >
              <option value="above">High values</option>
              <option value="below">Low values</option>
            </select>
          </div>
          <small className="axis-help-text">
            High values alert at or above a threshold (temperature, current); low values at or below it (battery,
            pressure). Leave a threshold empty to not use it.
          </small>
        </div>
      )}

      {type === 'state' && (
        <div className="settings-section">
          <h4>States</h4>
          <div className="setting-group state-mappings">
            <div className="state-mapping-list" role="list" aria-label="States">
              {mappings.map((mapping, index) => (
                <div className="state-mapping-row" role="listitem" key={index}>
                  <input
                    type="text"
                    value={mapping.value}
                    onChange={(event) => setMapping(index, { value: event.target.value })}
                    placeholder="Value"
                    aria-label={`State ${index + 1} value`}
                    className="setting-input"
                  />
                  <input
                    type="text"
                    value={mapping.label}
                    onChange={(event) => setMapping(index, { label: event.target.value })}
                    placeholder="Shown as"
                    aria-label={`State ${index + 1} name`}
                    className="setting-input"
                  />
                  <select
                    value={mapping.tone}
                    onChange={(event) => setMapping(index, { tone: event.target.value as StateTone })}
                    aria-label={`State ${index + 1} colour`}
                    className={`setting-select state-tone-select tone-${mapping.tone}`}
                  >
                    {STATE_TONES.map(tone => <option key={tone} value={tone}>{TONE_LABELS[tone]}</option>)}
                  </select>
                  <button
                    type="button"
                    className="state-mapping-remove"
                    onClick={() => onChange({ stateMappings: mappings.filter((_, i) => i !== index) })}
                    aria-label={`Remove state ${index + 1}`}
                    title="Remove"
                  >
                    <FiTrash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <div className="state-mapping-actions">
              <button
                type="button"
                className="state-mapping-add"
                onClick={() => onChange({ stateMappings: [...mappings, { value: '', label: '', tone: 'neutral' }] })}
              >
                <FiPlus aria-hidden="true" /> Add state
              </button>
              {fieldKind === 'bool' && (
                <button
                  type="button"
                  className="state-mapping-add"
                  onClick={() => onChange({
                    stateMappings: [{ value: 'true', label: 'On', tone: 'ok' }, { value: 'false', label: 'Off', tone: 'neutral' }],
                  })}
                >
                  Use true / false
                </button>
              )}
            </div>
            <small className="axis-help-text">
              A value matches a state by text (ignoring case) or by number; true and false also match 1 and 0. A value
              with no state is shown as it is.
            </small>
          </div>
        </div>
      )}

      {type === 'setpoint' && (
        <div className="settings-section">
          <h4>Sending</h4>
          <div className="setting-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={Boolean(value.sendOnChange)}
                onChange={(event) => onChange({ sendOnChange: event.target.checked || undefined })}
              />
              Send on every change
            </label>
            <small className="axis-help-text">
              Off: adjust the value, then press Send (or Enter). On: each step or entry is sent at once, at most ten
              times a second.
            </small>
          </div>
        </div>
      )}

      {type === 'text' && (
        <div className="settings-section">
          <h4>History</h4>
          <div className="setting-group range-controls">
            <ValueControl
              label="Messages shown"
              value={value.historyLength ?? DEFAULT_TEXT_HISTORY}
              onChange={next => onChange({ historyLength: Math.round(next) })}
              step={1}
              min={1}
              max={50}
            />
          </div>
          <small className="axis-help-text">1 shows only the latest message, large; more keep a short log with times.</small>
        </div>
      )}

      {type !== 'setpoint' && (
        <div className="settings-section">
          <h4>Freshness</h4>
          <NumberField
            id="value-stale"
            label="Mark stale after (s)"
            value={value.staleAfterMs === undefined ? undefined : value.staleAfterMs / 1000}
            placeholder="Never"
            onChange={seconds => onChange({ staleAfterMs: seconds === undefined || seconds <= 0 ? undefined : Math.round(seconds * 1000) })}
            help="With no message for this long, the value dims and is marked stale."
          />
        </div>
      )}
    </>
  );
};

export default ValueSettings;
