import React, { useState, useEffect, useRef } from 'react';
import type { Ros } from 'roslib';
import { ROSActionNodeData } from '../types';
import {
  fetchActionGoalDetails,
  ActionFieldSchema,
} from '../services/rosDiscovery';
import { ACTION_TEMPLATES } from '../actionTemplates';
import './ActionParameterEditor.css';

interface ActionParameterEditorProps {
  nodeData: ROSActionNodeData;
  ros: Ros | null;
  onSave: (parameters: Record<string, any>) => void;
  onClose: () => void;
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

const BOOL_TYPES  = new Set(['bool', 'boolean']);
const FLOAT_TYPES = new Set(['float32', 'float64', 'float', 'double']);
const INT_TYPES   = new Set([
  'int8', 'int16', 'int32', 'int64',
  'uint8', 'uint16', 'uint32', 'uint64',
  'int', 'uint', 'byte', 'char',
]);

function isBoolType(t: string)   { return BOOL_TYPES.has(t); }
function isFloatType(t: string)  { return FLOAT_TYPES.has(t); }
function isNumberType(t: string) { return FLOAT_TYPES.has(t) || INT_TYPES.has(t); }

function getSliderProps(t: string): { min: number; max: number; step: number } {
  if (FLOAT_TYPES.has(t))                              return { min: -100, max: 100,   step: 0.01 };
  if (t === 'int8')                                    return { min: -128, max: 127,   step: 1 };
  if (t === 'uint8')                                   return { min: 0,    max: 255,   step: 1 };
  if (t === 'int16')                                   return { min: -32768, max: 32767, step: 1 };
  if (t === 'uint16')                                  return { min: 0,    max: 65535, step: 1 };
  if (t === 'int32' || t === 'int64' || t === 'int')   return { min: -1000, max: 1000, step: 1 };
  if (t === 'uint32' || t === 'uint64' || t === 'uint') return { min: 0,   max: 1000,  step: 1 };
  return { min: -100, max: 100, step: 0.1 };
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
  if (typeof value === 'string')  return 'string';
  if (typeof value === 'number')  return Number.isInteger(value) ? 'int32' : 'float64';
  if (Array.isArray(value))       return 'float64[]';
  return 'object';
}

function fieldsFromValues(vals: Record<string, any>): ActionFieldSchema[] {
  return Object.keys(vals).map((name) => ({
    name,
    rosType:  inferRosType(vals[name]),
    arrayLen: Array.isArray(vals[name]) ? vals[name].length : -1,
  }));
}

function formatPreview(
  rosType: string,
  val: unknown,
  subfields?: ActionFieldSchema[]
): string {
  if (val === undefined || val === null) return '—';
  if (isBoolType(rosType))   return val ? 'TRUE' : 'FALSE';
  if (isNumberType(rosType)) {
    const n = typeof val === 'number' ? val : 0;
    return isFloatType(rosType) ? n.toFixed(2) : String(n);
  }
  if (rosType === 'string') {
    const s = String(val);
    return s.length > 18 ? `${s.slice(0, 16)}…` : (s || '""');
  }
  if (subfields?.length) {
    return subfields.slice(0, 3).map((sf) => {
      const sv = (val as any)?.[sf.name];
      if (sv === undefined || sv === null) return `${sf.name}:—`;
      if (typeof sv === 'number')
        return `${sf.name}:${isFloatType(sf.rosType) ? sv.toFixed(1) : sv}`;
      return `${sf.name}:${sv}`;
    }).join('  ');
  }
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === 'object') {
    const keys = Object.keys(val as object).slice(0, 2);
    return keys.map((k) => `${k}:${(val as any)[k]}`).join('  ') || '{}';
  }
  return String(val);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

type NavFrame =
  | { kind: 'list'; path: string[] }
  | { kind: 'edit'; path: string[]; field: ActionFieldSchema };

// ─── Field list row ───────────────────────────────────────────────────────────

const FieldListRow: React.FC<{
  field: ActionFieldSchema;
  value: unknown;
  basePath: string[];
  onPush: (frame: NavFrame) => void;
  onInlineChange: (path: string[], val: unknown) => void;
}> = ({ field, value, basePath, onPush, onInlineChange }) => {
  const fieldPath    = [...basePath, field.name];
  const hasSubfields = (field.subfields?.length ?? 0) > 0;

  if (isBoolType(field.rosType)) {
    return (
      <div className="ape-list-row">
        <span className="ape-list-name">{field.name.toUpperCase()}</span>
        <button
          className={`ape-toggle${value ? ' on' : ''}`}
          onClick={() => onInlineChange(fieldPath, !value)}
          aria-pressed={!!value}
          type="button"
        >
          <span className="ape-toggle-track"><span className="ape-toggle-thumb" /></span>
        </button>
      </div>
    );
  }

  const shortType = field.rosType.split('/').pop() ?? field.rosType;
  const preview   = formatPreview(field.rosType, value, field.subfields);

  return (
    <button
      className="ape-list-row ape-list-row-tap"
      type="button"
      onClick={() =>
        onPush(
          hasSubfields
            ? { kind: 'list', path: fieldPath }
            : { kind: 'edit', path: basePath, field }
        )
      }
    >
      <div className="ape-list-left">
        <span className="ape-list-name">{field.name.toUpperCase()}</span>
        {hasSubfields && <span className="ape-type-badge">{shortType}</span>}
      </div>
      <div className="ape-list-right">
        <span className="ape-list-preview">{preview}</span>
        <span className="ape-chevron">›</span>
      </div>
    </button>
  );
};

// ─── Complex JSON textarea (arrays / opaque objects) ──────────────────────────

const ComplexEditView: React.FC<{
  field: ActionFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ field, value, onChange }) => {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr]   = useState<string | null>(null);
  const typeLabel = field.arrayLen >= 0
    ? `${field.rosType}[${field.arrayLen || '…'}]`
    : field.rosType;

  return (
    <div className="ape-edit-view">
      <span className="ape-type-badge" style={{ alignSelf: 'flex-start' }}>{typeLabel}</span>
      <textarea
        className={`ape-complex-ta${err ? ' has-error' : ''}`}
        value={text}
        rows={6}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try { onChange(JSON.parse(e.target.value)); setErr(null); }
          catch { setErr('JSON error'); }
        }}
      />
      {err && <span className="ape-field-err">{err}</span>}
    </div>
  );
};

// ─── Focused field editor (layer 2) ──────────────────────────────────────────

const FieldEditView: React.FC<{
  field: ActionFieldSchema;
  value: unknown;
  onChange: (val: unknown) => void;
}> = ({ field, value, onChange }) => {
  const { min, max, step } = getSliderProps(field.rosType);
  const isFloat = isFloatType(field.rosType);
  const numVal  = typeof value === 'number' ? value : 0;
  const sliderVal = Math.max(min, Math.min(max, numVal));

  if (isNumberType(field.rosType) && field.arrayLen === -1) {
    return (
      <div className="ape-edit-view">
        <div className="ape-edit-big-value">
          <input
            type="number"
            className="ape-edit-number-input"
            value={numVal}
            step={isFloat ? 'any' : '1'}
            onChange={(e) => {
              const v = isFloat
                ? parseFloat(e.target.value)
                : parseInt(e.target.value, 10);
              if (!isNaN(v)) onChange(v);
            }}
          />
          <span className="ape-type-badge">{field.rosType}</span>
        </div>
        <div className="ape-edit-slider-wrap">
          <input
            type="range"
            className="ape-slider ape-slider-large"
            min={min} max={max} step={step}
            value={sliderVal}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <div className="ape-slider-labels">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </div>
      </div>
    );
  }

  if (field.rosType === 'string') {
    return (
      <div className="ape-edit-view">
        <input
          type="text"
          className="ape-text-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value…"
          autoFocus
        />
      </div>
    );
  }

  return <ComplexEditView field={field} value={value} onChange={onChange} />;
};

// ─── Main component ───────────────────────────────────────────────────────────

const ActionParameterEditor: React.FC<ActionParameterEditorProps> = ({
  nodeData,
  ros,
  onSave,
  onClose,
}) => {
  const [fields, setFields]           = useState<ActionFieldSchema[]>([]);
  const [values, setValues]           = useState<Record<string, any>>({});
  const [viewMode, setViewMode]       = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText]       = useState('{}');
  const [jsonError, setJsonError]     = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [navStack, setNavStack]       = useState<NavFrame[]>([{ kind: 'list', path: [] }]);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentFrame = navStack[navStack.length - 1];
  const canGoBack    = navStack.length > 1;
  const pushFrame    = (f: NavFrame) => setNavStack((s) => [...s, f]);
  const popFrame     = ()            => setNavStack((s) => s.length > 1 ? s.slice(0, -1) : s);

  // ── Schema loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    const existing    = nodeData.parameters ?? {};
    const hasExisting = Object.keys(existing).length > 0;
    const template    = nodeData.actionType ? ACTION_TEMPLATES[nodeData.actionType] : null;
    const initialVals: Record<string, any> = hasExisting
      ? existing
      : (template as Record<string, any> ?? {});

    setValues(initialVals);
    setJsonText(JSON.stringify(initialVals, null, 2));
    setNavStack([{ kind: 'list', path: [] }]);

    if (!ros || !nodeData.actionType) {
      if (Object.keys(initialVals).length > 0) setFields(fieldsFromValues(initialVals));
      return;
    }

    setIsLoading(true);
    fetchActionGoalDetails(ros, nodeData.actionType).then((details) => {
      setIsLoading(false);
      if (!details) {
        if (Object.keys(initialVals).length > 0) setFields(fieldsFromValues(initialVals));
        return;
      }
      setFields(details.fields);
      if (!hasExisting && !template) {
        const defaults = details.defaults as Record<string, any>;
        setValues(defaults);
        setJsonText(JSON.stringify(defaults, null, 2));
      }
    });
  }, [nodeData, ros]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Value manipulation ──────────────────────────────────────────────────────
  const setValueAtPath = (path: string[], val: unknown) =>
    setValues((prev) => {
      const next = setDeep(prev, path, val);
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try { setValues(JSON.parse(text)); setJsonError(null); }
    catch { setJsonError('Invalid JSON'); }
  };

  const toggleView = () => {
    if (viewMode === 'form') {
      setJsonText(JSON.stringify(values, null, 2));
      setViewMode('json');
    } else {
      try { setValues(JSON.parse(jsonText)); setJsonError(null); setViewMode('form'); }
      catch { setJsonError('Fix JSON errors before switching to form view'); }
    }
  };

  const handleSave = () => {
    if (viewMode === 'json') {
      try { onSave(JSON.parse(jsonText)); onClose(); }
      catch { setJsonError('Invalid JSON — fix before saving'); }
    } else {
      onSave(values);
      onClose();
    }
  };

  // ── Drag-to-resize ──────────────────────────────────────────────────────────
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelRef.current?.getBoundingClientRect().height ?? 400;
    const onMove = (ev: PointerEvent) =>
      setPanelHeight(Math.max(180, startH + (startY - ev.clientY)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Field resolution at current nav level ───────────────────────────────────
  const getCurrentFields = (): ActionFieldSchema[] => {
    if (currentFrame.kind !== 'list') return [];
    let cur = fields;
    for (const seg of currentFrame.path) {
      cur = cur.find((f) => f.name === seg)?.subfields ?? [];
    }
    return cur;
  };

  // ── Header label ────────────────────────────────────────────────────────────
  const shortName   = nodeData.actionName.split('/').filter(Boolean).pop() ?? nodeData.actionName;
  const headerLabel = !canGoBack
    ? shortName
    : currentFrame.kind === 'edit'
      ? currentFrame.field.name.toUpperCase()
      : currentFrame.path.length > 0
        ? currentFrame.path[currentFrame.path.length - 1].toUpperCase()
        : shortName;

  const panelStyle: React.CSSProperties = panelHeight
    ? { height: panelHeight, maxHeight: 'none' }
    : {};

  return (
    <div className="ape-overlay" onClick={onClose}>
      <div
        className="ape-panel"
        ref={panelRef}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="ape-drag-handle" onPointerDown={handleDragStart} />

        {/* Header */}
        <div className="ape-header">
          <div className="ape-header-left">
            {canGoBack ? (
              <button className="ape-back-btn" onClick={popFrame} type="button">‹</button>
            ) : (
              isLoading && <span className="ape-loading-dot" />
            )}
            <span className="ape-title">{headerLabel}</span>
            {isLoading && canGoBack && <span className="ape-loading-dot" />}
          </div>
          <div className="ape-header-right">
            <button className="ape-view-toggle" onClick={toggleView} type="button">
              {viewMode === 'form' ? 'JSON' : 'FORM'}
            </button>
            <button className="ape-close-btn" onClick={onClose} type="button">✕</button>
          </div>
        </div>

        {/* Subtitle — only at root */}
        {!canGoBack && (
          <div className="ape-subtitle">{nodeData.actionType || 'Unknown type'}</div>
        )}

        {/* Body */}
        <div className="ape-body">
          {viewMode === 'json' ? (
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
          ) : isLoading && fields.length === 0 ? (
            <div className="ape-skeleton">
              {[0, 1, 2].map((i) => <div key={i} className="ape-skeleton-row" />)}
            </div>
          ) : fields.length === 0 ? (
            <div className="ape-empty">
              No schema available.<br />
              Switch to <strong>JSON</strong> to enter parameters manually.
            </div>
          ) : currentFrame.kind === 'list' ? (
            <div className="ape-field-list">
              {getCurrentFields().map((f) => (
                <FieldListRow
                  key={f.name}
                  field={f}
                  value={getDeep(values, [...currentFrame.path, f.name])}
                  basePath={currentFrame.path}
                  onPush={pushFrame}
                  onInlineChange={setValueAtPath}
                />
              ))}
            </div>
          ) : currentFrame.kind === 'edit' ? (
            <FieldEditView
              field={currentFrame.field}
              value={getDeep(values, [...currentFrame.path, currentFrame.field.name])}
              onChange={(val) =>
                setValueAtPath([...currentFrame.path, currentFrame.field.name], val)
              }
            />
          ) : null}
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

export default ActionParameterEditor;
