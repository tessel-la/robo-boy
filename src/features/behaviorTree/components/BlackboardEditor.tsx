import React, { useEffect, useState } from 'react';
import { BlackboardValueType } from '../types';
import './BlackboardEditor.css';

interface Props {
  values: Record<string, unknown>;
  types?: Record<string, BlackboardValueType>;
  readOnly?: boolean;
  onChange: (values: Record<string, unknown>, types: Record<string, BlackboardValueType>) => void;
}

const inferredType = (value: unknown): BlackboardValueType => {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int32' : 'float64';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) {
    return value.every(item => typeof item === 'string') ? 'stringArray' : 'numberArray';
  }
  return 'json';
};

const xyz = () => ({ x: 0, y: 0, z: 0 });
const defaultFor = (type: BlackboardValueType): unknown => ({
  bool: false,
  int32: 0,
  int64: 0,
  float32: 0,
  float64: 0,
  string: '',
  numberArray: [],
  stringArray: [],
  vector3: xyz(),
  point: xyz(),
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  pose: { position: xyz(), orientation: { x: 0, y: 0, z: 0, w: 1 } },
  twist: { linear: xyz(), angular: xyz() },
  time: { sec: 0, nanosec: 0 },
  duration: { sec: 0, nanosec: 0 },
  json: {},
})[type];

const isNumeric = (type: BlackboardValueType) => ['int32', 'int64', 'float32', 'float64'].includes(type);
const isStructured = (type: BlackboardValueType) => !['bool', 'int32', 'int64', 'float32', 'float64', 'string'].includes(type);
const pinKind = (type: BlackboardValueType) => type === 'bool' ? 'boolean' : isNumeric(type) ? 'number' : type === 'string' ? 'string' : 'json';

const JsonValueInput: React.FC<{
  name: string;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}> = ({ name, value, readOnly, onChange }) => {
  const [text, setText] = useState(() => JSON.stringify(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(JSON.stringify(value)), [value]);
  return (
    <input
      className={invalid ? 'invalid' : ''}
      aria-label={`Value for ${name}`}
      value={text}
      readOnly={readOnly}
      spellCheck={false}
      onChange={event => {
        const next = event.target.value;
        setText(next);
        try {
          onChange(JSON.parse(next));
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
};

const BlackboardEditor: React.FC<Props> = ({ values, types = {}, readOnly = false, onChange }) => {
  const [draftName, setDraftName] = useState('');

  const resolvedTypes = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, types[name] || inferredType(value)])) as Record<string, BlackboardValueType>;
  const setValue = (name: string, value: unknown) => onChange({ ...values, [name]: value }, resolvedTypes);
  const setType = (name: string, type: BlackboardValueType) => onChange(
    { ...values, [name]: defaultFor(type) },
    { ...resolvedTypes, [name]: type }
  );
  const remove = (name: string) => {
    const next = { ...values };
    const nextTypes = { ...resolvedTypes };
    delete next[name];
    delete nextTypes[name];
    onChange(next, nextTypes);
  };
  const add = () => {
    const name = draftName.trim();
    if (!name || Object.prototype.hasOwnProperty.call(values, name)) return;
    onChange({ ...values, [name]: false }, { ...resolvedTypes, [name]: 'bool' });
    setDraftName('');
  };

  return (
    <div className={`bbeditor${readOnly ? ' readonly' : ''}`}>
      <div className="bbeditor-head">
        <span>{readOnly ? 'Live values' : 'Variables'}</span>
        <small>{Object.keys(values).length}</small>
      </div>
      {Object.keys(values).length === 0 && (
        <div className="bbeditor-empty">Create a value, then connect it from a ROS node.</div>
      )}
      <div className="bbeditor-list">
        {Object.entries(values).map(([name, value]) => {
          const kind = resolvedTypes[name];
          return (
            <div className="bbeditor-row" key={name}>
              <span className={`bbeditor-pin ${pinKind(kind)}`} aria-hidden="true" />
              <input
                className="bbeditor-name"
                value={name}
                readOnly
                aria-label={`Variable name ${name}`}
                title="Variable keys stay stable so node connections remain valid"
                spellCheck={false}
              />
              <select
                aria-label={`Type for ${name}`}
                value={kind}
                disabled={readOnly}
                onChange={event => setType(name, event.target.value as BlackboardValueType)}
              >
                <optgroup label="Primitives">
                  <option value="bool">Bool</option>
                  <option value="int32">Int32</option>
                  <option value="int64">Int64</option>
                  <option value="float32">Float32</option>
                  <option value="float64">Double</option>
                  <option value="string">String</option>
                </optgroup>
                <optgroup label="Collections">
                  <option value="numberArray">Number array</option>
                  <option value="stringArray">String array</option>
                </optgroup>
                <optgroup label="ROS common">
                  <option value="vector3">Vector3</option>
                  <option value="point">Point</option>
                  <option value="quaternion">Quaternion</option>
                  <option value="pose">Pose</option>
                  <option value="twist">Twist</option>
                  <option value="time">Time</option>
                  <option value="duration">Duration</option>
                </optgroup>
                <option value="json">JSON</option>
              </select>
              {kind === 'bool' ? (
                <button
                  type="button"
                  className={`bbeditor-bool${value ? ' on' : ''}`}
                  disabled={readOnly}
                  onClick={() => setValue(name, !value)}
                  aria-label={`Value for ${name}`}
                >
                  {value ? 'TRUE' : 'FALSE'}
                </button>
              ) : isStructured(kind) ? (
                <JsonValueInput name={name} value={value} readOnly={readOnly} onChange={next => setValue(name, next)} />
              ) : (
                <input
                  aria-label={`Value for ${name}`}
                  type={isNumeric(kind) ? 'number' : 'text'}
                  step={kind === 'int32' || kind === 'int64' ? '1' : 'any'}
                  value={String(value)}
                  readOnly={readOnly}
                  onChange={event =>
                    setValue(name, isNumeric(kind) ? Number(event.target.value) : event.target.value)
                  }
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="bbeditor-remove"
                  onClick={() => remove(name)}
                  aria-label={`Delete ${name}`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div className="bbeditor-new">
          <span className="bbeditor-pin json" aria-hidden="true" />
          <input
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') add();
            }}
            placeholder="new_variable"
            aria-label="New blackboard variable"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draftName.trim() || Object.prototype.hasOwnProperty.call(values, draftName.trim())}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
};

export default BlackboardEditor;
