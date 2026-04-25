import React, { useState, useEffect } from 'react';
import type { Ros } from 'roslib';
import { ROSServiceNodeData } from '../types';
import {
  fetchServiceRequestSchema,
  ActionFieldSchema,
} from '../services/rosDiscovery';
import './ActionParameterEditor.css';

interface ServiceParameterEditorProps {
  nodeData: ROSServiceNodeData;
  ros: Ros | null;
  onSave: (request: Record<string, any>) => void;
  onClose: () => void;
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

const SCALAR_TYPES = new Set([
  'bool', 'string',
  'int8', 'int16', 'int32', 'int64',
  'uint8', 'uint16', 'uint32', 'uint64',
  'float32', 'float64', 'byte', 'char',
  // Aliases rosapi sometimes returns instead of the standard names
  'float', 'double', 'int', 'uint',
]);

function isScalar(rosType: string): boolean {
  return SCALAR_TYPES.has(rosType);
}

function getSliderProps(rosType: string): { min: number; max: number; step: number } {
  switch (rosType) {
    case 'float32': case 'float64': case 'float': case 'double':
      return { min: -100, max: 100, step: 0.01 };
    case 'int8':    return { min: -128,   max: 127,   step: 1 };
    case 'uint8':   return { min: 0,      max: 255,   step: 1 };
    case 'int16':   return { min: -32768, max: 32767, step: 1 };
    case 'uint16':  return { min: 0,      max: 65535, step: 1 };
    case 'int32': case 'int64': case 'int':  return { min: -1000, max: 1000, step: 1 };
    case 'uint32': case 'uint64': case 'uint': return { min: 0,   max: 1000, step: 1 };
    default: return { min: -100, max: 100, step: 0.1 };
  }
}

function getDeep(obj: any, path: string[]): any {
  return path.reduce((v, k) => (v != null ? v[k] : undefined), obj);
}

function setDeep(obj: any, path: string[], value: any): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  return { ...obj, [head]: setDeep(obj?.[head] ?? {}, rest, value) };
}

function inferRosType(value: unknown): string {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int32' : 'float64';
  if (Array.isArray(value)) return 'float64[]';
  return 'object';
}

function fieldsFromValues(vals: Record<string, any>): ActionFieldSchema[] {
  return Object.keys(vals).map((name) => ({
    name,
    rosType: inferRosType(vals[name]),
    arrayLen: Array.isArray(vals[name]) ? vals[name].length : -1,
  }));
}

// ─── Field sub-components ─────────────────────────────────────────────────────

const NumberRow: React.FC<{
  name: string;
  type: string;
  value: number;
  onChange: (v: number) => void;
}> = ({ name, type, value, onChange }) => {
  const { min, max, step } = getSliderProps(type);
  const isFloat = type === 'float' || type === 'double' || type.startsWith('float');
  const sliderVal = Math.max(min, Math.min(max, value));

  return (
    <div className="ape-row ape-row-number">
      <div className="ape-row-header">
        <span className="ape-fname">{name}</span>
        <input
          type="number"
          className="ape-num-input"
          value={value}
          step={isFloat ? 'any' : '1'}
          onChange={(e) => {
            const v = isFloat
              ? parseFloat(e.target.value)
              : parseInt(e.target.value, 10);
            if (!isNaN(v)) onChange(v);
          }}
        />
      </div>
      <input
        type="range"
        className="ape-slider"
        min={min}
        max={max}
        step={step}
        value={sliderVal}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <div className="ape-slider-labels">
        <span>{min}</span>
        <span className="ape-type-badge">{type}</span>
        <span>{max}</span>
      </div>
    </div>
  );
};

const BoolRow: React.FC<{
  name: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ name, value, onChange }) => (
  <div className="ape-row ape-row-bool">
    <span className="ape-fname">{name}</span>
    <button
      className={`ape-toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
      aria-pressed={value}
      type="button"
    >
      <span className="ape-toggle-track">
        <span className="ape-toggle-thumb" />
      </span>
      <span className="ape-toggle-text">{value ? 'TRUE' : 'FALSE'}</span>
    </button>
  </div>
);

const StringRow: React.FC<{
  name: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ name, value, onChange }) => (
  <div className="ape-row ape-row-string">
    <span className="ape-fname">{name}</span>
    <input
      type="text"
      className="ape-text-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter value…"
    />
  </div>
);

const ComplexRow: React.FC<{
  name: string;
  type: string;
  arrayLen: number;
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ name, type, arrayLen, value, onChange }) => {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const typeLabel = arrayLen >= 0 ? `${type}[${arrayLen || '…'}]` : type;

  return (
    <div className="ape-row ape-row-complex">
      <div className="ape-row-header">
        <span className="ape-fname">{name}</span>
        <span className="ape-type-badge">{typeLabel}</span>
      </div>
      <textarea
        className={`ape-complex-ta${err ? ' has-error' : ''}`}
        value={text}
        rows={3}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr(null);
          } catch {
            setErr('JSON error');
          }
        }}
      />
      {err && <span className="ape-field-err">{err}</span>}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const ServiceParameterEditor: React.FC<ServiceParameterEditorProps> = ({
  nodeData,
  ros,
  onSave,
  onClose,
}) => {
  const [fields, setFields] = useState<ActionFieldSchema[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [viewMode, setViewMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const existing = nodeData.request ?? {};
    const hasExisting = Object.keys(existing).length > 0;
    const initialVals: Record<string, any> = hasExisting ? existing : {};

    setValues(initialVals);
    setJsonText(JSON.stringify(initialVals, null, 2));

    if (!ros || !nodeData.serviceType) {
      if (Object.keys(initialVals).length > 0) {
        setFields(fieldsFromValues(initialVals));
      }
      return;
    }

    setIsLoading(true);
    fetchServiceRequestSchema(ros, nodeData.serviceType).then((details) => {
      setIsLoading(false);
      if (!details) {
        if (Object.keys(initialVals).length > 0) {
          setFields(fieldsFromValues(initialVals));
        }
        return;
      }
      setFields(details.fields);
      if (!hasExisting) {
        const defaults = details.defaults as Record<string, any>;
        setValues(defaults);
        setJsonText(JSON.stringify(defaults, null, 2));
      }
    });
  }, [nodeData, ros]); // eslint-disable-line react-hooks/exhaustive-deps

  const setValueAtPath = (path: string[], val: unknown) => {
    setValues((prev) => {
      const next = setDeep(prev, path, val);
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      setValues(JSON.parse(text));
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const toggleView = () => {
    if (viewMode === 'form') {
      setJsonText(JSON.stringify(values, null, 2));
      setViewMode('json');
    } else {
      try {
        const parsed = JSON.parse(jsonText);
        setValues(parsed);
        setJsonError(null);
        setViewMode('form');
      } catch {
        setJsonError('Fix JSON errors before switching to form view');
      }
    }
  };

  const handleSave = () => {
    if (viewMode === 'json') {
      try {
        onSave(JSON.parse(jsonText));
        onClose();
      } catch {
        setJsonError('Invalid JSON — fix before saving');
      }
    } else {
      onSave(values);
      onClose();
    }
  };

  const renderField = (field: ActionFieldSchema, path: string[] = []): React.ReactNode => {
    const fullPath = [...path, field.name];
    const key = fullPath.join('.');
    const val = getDeep(values, fullPath);
    const set = (v: unknown) => setValueAtPath(fullPath, v);

    // Expanded nested message type — labelled section with sub-rows
    if (field.subfields && field.subfields.length > 0) {
      const shortType = field.rosType.split('/').pop() ?? field.rosType;
      return (
        <div key={key} className="ape-section">
          <div className="ape-section-header">
            <span className="ape-fname">{field.name}</span>
            <span className="ape-type-badge">{shortType}</span>
          </div>
          <div className="ape-section-body">
            {field.subfields.map((sf) => renderField(sf, fullPath))}
          </div>
        </div>
      );
    }

    if (field.rosType === 'bool') {
      return <BoolRow key={key} name={field.name} value={!!val} onChange={(v) => set(v)} />;
    }
    if (field.rosType === 'string') {
      return <StringRow key={key} name={field.name} value={String(val ?? '')} onChange={(v) => set(v)} />;
    }
    if (field.arrayLen === -1 && isScalar(field.rosType)) {
      return (
        <NumberRow
          key={key}
          name={field.name}
          type={field.rosType}
          value={typeof val === 'number' ? val : 0}
          onChange={(v) => set(v)}
        />
      );
    }
    return (
      <ComplexRow
        key={key}
        name={field.name}
        type={field.rosType}
        arrayLen={field.arrayLen}
        value={val}
        onChange={(v) => set(v)}
      />
    );
  };

  const shortName =
    nodeData.serviceName.split('/').filter(Boolean).pop() ?? nodeData.serviceName;

  return (
    <div className="ape-overlay" onClick={onClose}>
      <div className="ape-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ape-header">
          <div className="ape-header-left">
            <span className="ape-title">{shortName}</span>
            {isLoading && <span className="ape-loading-dot" />}
          </div>
          <div className="ape-header-right">
            <button className="ape-view-toggle" onClick={toggleView} type="button">
              {viewMode === 'form' ? 'JSON' : 'FORM'}
            </button>
            <button className="ape-close-btn" onClick={onClose} type="button">
              ✕
            </button>
          </div>
        </div>

        {/* Subtitle: service type */}
        <div className="ape-subtitle">{nodeData.serviceType || 'Unknown type'}</div>

        {/* Body */}
        <div className="ape-body">
          {viewMode === 'form' ? (
            <div className="ape-fields">
              {isLoading && fields.length === 0 ? (
                <div className="ape-skeleton">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="ape-skeleton-row" />
                  ))}
                </div>
              ) : fields.length === 0 ? (
                <div className="ape-empty">
                  No schema available.
                  <br />
                  Switch to <strong>JSON</strong> to enter request manually.
                </div>
              ) : (
                fields.map((f) => renderField(f))
              )}
            </div>
          ) : (
            <div className="ape-json-view">
              <textarea
                className="ape-json-ta"
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                spellCheck={false}
                placeholder="{}"
              />
              {jsonError && <div className="ape-json-error">{jsonError}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ape-footer">
          <button className="ape-btn ape-btn-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="ape-btn ape-btn-save"
            onClick={handleSave}
            disabled={isLoading}
            type="button"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServiceParameterEditor;
