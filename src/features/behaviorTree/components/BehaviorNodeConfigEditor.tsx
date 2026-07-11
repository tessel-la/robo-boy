import React, { useState } from 'react';
import {
  BehaviorNodeType,
  BehaviorTreeNode,
  IfElseNodeData,
  ROSSubscriberNodeData,
  ROSTopicNodeData,
  TimeoutNodeData,
} from '../types';
import type { BlackboardInputBinding, BlackboardOutputBinding } from '../types';
import BlackboardBindingEditor, { BlackboardPathSuggestion, completeBindings } from './BlackboardBindingEditor';
import './ActionParameterEditor.css';

interface Props {
  node: BehaviorTreeNode;
  blackboardVariables: string[];
  blackboardValues?: Record<string, unknown>;
  onSave: (data: BehaviorTreeNode['data']) => void;
  onClose: () => void;
}

const inferredType = (value: unknown): string => {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'float64';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'object[]';
  return 'object';
};

const valuePaths = (value: unknown, prefix = ''): BlackboardPathSuggestion[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [{ path: prefix, rosType: inferredType(value) }] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const nested = valuePaths(child, path);
    return nested.length ? nested : [{ path, rosType: inferredType(child) }];
  });
};

const BehaviorNodeConfigEditor: React.FC<Props> = ({ node, blackboardVariables, blackboardValues = {}, onSave, onClose }) => {
  const [data, setData] = useState(node.data);
  const [payload, setPayload] = useState(() => JSON.stringify(
    node.type === BehaviorNodeType.Topic ? (node.data as ROSTopicNodeData).message || {} : {},
    null,
    2
  ));
  const [inputBindings, setInputBindings] = useState<BlackboardInputBinding[]>(() => (
    node.type === BehaviorNodeType.Topic ? (node.data as ROSTopicNodeData).inputBindings || [] : []
  ));
  const [outputBindings, setOutputBindings] = useState<BlackboardOutputBinding[]>(() => (
    node.type === BehaviorNodeType.Subscriber ? (node.data as ROSSubscriberNodeData).outputBindings || [] : []
  ));
  const [error, setError] = useState('');

  const save = () => {
    try {
      if (node.type === BehaviorNodeType.Timeout) {
        const timeout = Number((data as TimeoutNodeData).timeout);
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Timeout must be positive.');
      }
      if (node.type === BehaviorNodeType.Topic) {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const mapped = completeBindings(inputBindings);
        onSave({ ...data, message: parsed, inputBindings: mapped } as ROSTopicNodeData);
      } else if (node.type === BehaviorNodeType.Subscriber) {
        const mapped = completeBindings(outputBindings);
        if (mapped.length === 0) throw new Error('Add at least one message-path mapping.');
        onSave({ ...data, outputBindings: mapped } as ROSSubscriberNodeData);
      } else {
        onSave(data);
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid configuration.');
    }
  };

  const input = (label: string, value: string | number, onChange: (value: string) => void, type = 'text') => (
    <label className="bt-config-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={event => onChange(event.target.value)} />
    </label>
  );

  return (
    <div className="ape-overlay" onClick={onClose}>
      <div className="ape-panel bt-config-panel" onClick={event => event.stopPropagation()}>
        <div className="ape-header">
          <span className="ape-title">{data.label}</span>
          <button className="ape-close-btn" onClick={onClose} type="button" aria-label="Close">x</button>
        </div>
        <div className="ape-body bt-config-body">
          {node.type === BehaviorNodeType.Timeout && input(
            'Timeout (ms)',
            (data as TimeoutNodeData).timeout,
            value => setData({ ...data, timeout: Number(value) } as TimeoutNodeData),
            'number'
          )}
          {node.type === BehaviorNodeType.IfElse && (
            <>
              <label className="bt-config-field"><span>Blackboard variable</span>
                <input
                  list="bt-blackboard-variable-list"
                  value={(data as IfElseNodeData).variable}
                  onChange={event => setData({ ...data, variable: event.target.value } as IfElseNodeData)}
                />
                <datalist id="bt-blackboard-variable-list">
                  {blackboardVariables.map(variable => <option key={variable} value={variable} />)}
                </datalist>
              </label>
              <label className="bt-config-field"><span>Comparison</span>
                <select
                  value={(data as IfElseNodeData).operator}
                  onChange={event => setData({ ...data, operator: event.target.value } as IfElseNodeData)}
                >
                  {['truthy', 'falsy', 'equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'exists']
                    .map(operator => <option key={operator} value={operator}>{operator}</option>)}
                </select>
              </label>
              {input('Expected JSON value', JSON.stringify((data as IfElseNodeData).expectedValue ?? true), value => {
                try { setData({ ...data, expectedValue: JSON.parse(value) } as IfElseNodeData); } catch { /* validate on save */ }
              })}
            </>
          )}
          {node.type === BehaviorNodeType.Topic && (
            <>
              <label className="bt-config-field"><span>Message JSON</span>
                <textarea value={payload} onChange={event => setPayload(event.target.value)} spellCheck={false} />
              </label>
              {input('Frequency (Hz, empty for once)', (data as ROSTopicNodeData).frequencyHz ?? '', value => setData({ ...data, frequencyHz: value ? Number(value) : undefined } as ROSTopicNodeData), 'number')}
              {input('Duration (ms, 0 for continuous)', (data as ROSTopicNodeData).durationMs ?? 1000, value => setData({ ...data, durationMs: Number(value) } as ROSTopicNodeData), 'number')}
            </>
          )}
          {node.type === BehaviorNodeType.Subscriber && input('Timeout (ms)', (data as ROSSubscriberNodeData).timeout ?? 10000, value => setData({ ...data, timeout: Number(value) } as ROSSubscriberNodeData), 'number')}
          {node.type === BehaviorNodeType.Topic && (
            <BlackboardBindingEditor
              direction="input"
              bindings={inputBindings}
              onChange={bindings => setInputBindings(bindings as BlackboardInputBinding[])}
              blackboardVariables={blackboardVariables}
              blackboardValues={blackboardValues}
              pathSuggestions={valuePaths((data as ROSTopicNodeData).message)}
              pathLabel="Message field"
            />
          )}
          {node.type === BehaviorNodeType.Subscriber && (
            <BlackboardBindingEditor
              direction="output"
              bindings={outputBindings}
              onChange={bindings => setOutputBindings(bindings as BlackboardOutputBinding[])}
              blackboardVariables={blackboardVariables}
              pathLabel="Message field"
              emptyHint="Connect at least one incoming field"
            />
          )}
          {error && <div className="ape-json-error">{error}</div>}
        </div>
        <div className="ape-footer">
          <button className="ape-btn ape-btn-cancel" onClick={onClose} type="button">Cancel</button>
          <button className="ape-btn ape-btn-save" onClick={save} type="button">Save</button>
        </div>
      </div>
    </div>
  );
};

export default BehaviorNodeConfigEditor;
