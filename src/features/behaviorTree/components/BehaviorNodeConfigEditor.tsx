import React, { useMemo, useState } from 'react';
import {
  BehaviorNodeType,
  BehaviorTreeNode,
  IfElseNodeData,
  ROSSubscriberNodeData,
  ROSTopicNodeData,
  TimeoutNodeData,
} from '../types';
import './ActionParameterEditor.css';

interface Props {
  node: BehaviorTreeNode;
  blackboardVariables: string[];
  onSave: (data: BehaviorTreeNode['data']) => void;
  onClose: () => void;
}

const parseBindings = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
  const [path, variable] = line.split('=').map(part => part.trim());
  return { path, variable };
}).filter(binding => binding.path && binding.variable);

const formatBindings = (bindings: Array<{ sourcePath?: string; targetPath?: string; variable: string }> = []) => (
  bindings.map(binding => `${binding.sourcePath ?? binding.targetPath ?? ''}=${binding.variable}`).join('\n')
);

const BehaviorNodeConfigEditor: React.FC<Props> = ({ node, blackboardVariables, onSave, onClose }) => {
  const [data, setData] = useState(node.data);
  const [payload, setPayload] = useState(() => JSON.stringify(
    node.type === BehaviorNodeType.Topic ? (node.data as ROSTopicNodeData).message || {} : {},
    null,
    2
  ));
  const initialBindings = useMemo(() => {
    if (node.type === BehaviorNodeType.Topic) return formatBindings((node.data as ROSTopicNodeData).inputBindings);
    if (node.type === BehaviorNodeType.Subscriber) return formatBindings((node.data as ROSSubscriberNodeData).outputBindings);
    return '';
  }, [node]);
  const [bindings, setBindings] = useState(initialBindings);
  const [error, setError] = useState('');

  const save = () => {
    try {
      if (node.type === BehaviorNodeType.Timeout) {
        const timeout = Number((data as TimeoutNodeData).timeout);
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Timeout must be positive.');
      }
      if (node.type === BehaviorNodeType.Topic) {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const mapped = parseBindings(bindings).map(binding => ({
          targetPath: binding.path,
          variable: binding.variable,
        }));
        onSave({ ...data, message: parsed, inputBindings: mapped } as ROSTopicNodeData);
      } else if (node.type === BehaviorNodeType.Subscriber) {
        const mapped = parseBindings(bindings).map(binding => ({
          sourcePath: binding.path,
          variable: binding.variable,
        }));
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
          {(node.type === BehaviorNodeType.Topic || node.type === BehaviorNodeType.Subscriber) && (
            <label className="bt-config-field"><span>{node.type === BehaviorNodeType.Topic ? 'Target path = variable' : 'Source path = variable'}</span>
              <textarea value={bindings} onChange={event => setBindings(event.target.value)} placeholder="data=enabled" spellCheck={false} />
            </label>
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
