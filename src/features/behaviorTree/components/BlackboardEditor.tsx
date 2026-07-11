import React, { useEffect, useState } from 'react';
import './BlackboardEditor.css';

interface Props {
  values: Record<string, unknown>;
  readOnly?: boolean;
  onChange: (values: Record<string, unknown>) => void;
}

type ValueKind = 'boolean' | 'number' | 'string' | 'json';

const kindOf = (value: unknown): ValueKind => {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
};

const defaultFor = (kind: ValueKind): unknown => ({ boolean: false, number: 0, string: '', json: {} })[kind];

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

const BlackboardEditor: React.FC<Props> = ({ values, readOnly = false, onChange }) => {
  const [draftName, setDraftName] = useState('');

  const setValue = (name: string, value: unknown) => onChange({ ...values, [name]: value });
  const remove = (name: string) => {
    const next = { ...values };
    delete next[name];
    onChange(next);
  };
  const add = () => {
    const name = draftName.trim();
    if (!name || Object.prototype.hasOwnProperty.call(values, name)) return;
    onChange({ ...values, [name]: null });
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
          const kind = kindOf(value);
          return (
            <div className="bbeditor-row" key={name}>
              <span className={`bbeditor-pin ${kind}`} aria-hidden="true" />
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
                onChange={event => setValue(name, defaultFor(event.target.value as ValueKind))}
              >
                <option value="boolean">Bool</option>
                <option value="number">Number</option>
                <option value="string">Text</option>
                <option value="json">JSON</option>
              </select>
              {kind === 'boolean' ? (
                <button
                  type="button"
                  className={`bbeditor-bool${value ? ' on' : ''}`}
                  disabled={readOnly}
                  onClick={() => setValue(name, !value)}
                  aria-label={`Value for ${name}`}
                >
                  {value ? 'TRUE' : 'FALSE'}
                </button>
              ) : kind === 'json' ? (
                <JsonValueInput name={name} value={value} readOnly={readOnly} onChange={next => setValue(name, next)} />
              ) : (
                <input
                  aria-label={`Value for ${name}`}
                  type={kind === 'number' ? 'number' : 'text'}
                  value={String(value)}
                  readOnly={readOnly}
                  onChange={event =>
                    setValue(name, kind === 'number' ? Number(event.target.value) : event.target.value)
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
