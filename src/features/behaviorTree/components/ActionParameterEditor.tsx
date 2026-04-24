import React, { useState, useEffect } from 'react';
import type { Ros } from 'roslib';
import { ROSActionNodeData } from '../types';
import { fetchActionGoalSchema } from '../services/rosDiscovery';
import { ACTION_TEMPLATES } from '../actionTemplates';
import './ActionParameterEditor.css';

interface ActionParameterEditorProps {
  nodeData: ROSActionNodeData;
  ros: Ros | null;
  onSave: (parameters: Record<string, any>) => void;
  onClose: () => void;
}

const ActionParameterEditor: React.FC<ActionParameterEditorProps> = ({
  nodeData,
  ros,
  onSave,
  onClose,
}) => {
  const [parameterJson, setParameterJson] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  // On mount: existing params → hardcoded template → live schema fetch
  useEffect(() => {
    const existing = nodeData.parameters ?? {};

    if (Object.keys(existing).length > 0) {
      setParameterJson(JSON.stringify(existing, null, 2));
      return;
    }

    const template = nodeData.actionType ? ACTION_TEMPLATES[nodeData.actionType] : null;
    if (template) {
      setParameterJson(JSON.stringify(template, null, 2));
      return;
    }

    // Unknown type — try to introspect via rosapi
    if (ros && nodeData.actionType) {
      setIsFetching(true);
      fetchActionGoalSchema(ros, nodeData.actionType).then((schema) => {
        setIsFetching(false);
        setParameterJson(JSON.stringify(schema ?? {}, null, 2));
      });
    }
  }, [nodeData, ros]);

  const handleFetchSchema = () => {
    if (!ros || !nodeData.actionType) return;
    setIsFetching(true);
    setError(null);
    fetchActionGoalSchema(ros, nodeData.actionType).then((schema) => {
      setIsFetching(false);
      if (schema && Object.keys(schema).length > 0) {
        setParameterJson(JSON.stringify(schema, null, 2));
      } else {
        setError(
          'rosapi could not return field definitions for this type. ' +
          'Check the browser console for the raw response, then fill in parameters manually.'
        );
      }
    });
  };

  const handleLoadTemplate = () => {
    const template = nodeData.actionType ? ACTION_TEMPLATES[nodeData.actionType] : null;
    if (template) {
      setParameterJson(JSON.stringify(template, null, 2));
      setError(null);
    } else {
      setError('No built-in template for this action type. Use "Fetch Schema" or fill in manually.');
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(parameterJson);
      setError(null);
      onSave(parsed);
      onClose();
    } catch (e) {
      setError('Invalid JSON: ' + (e as Error).message);
    }
  };

  return (
    <div className="action-param-editor-overlay" onClick={onClose}>
      <div className="action-param-editor" onClick={(e) => e.stopPropagation()}>
        <div className="action-param-header">
          <h3>Edit Action Parameters</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="action-param-info">
          <div><strong>Action:</strong> {nodeData.actionName}</div>
          <div><strong>Type:</strong> {nodeData.actionType || 'Unknown'}</div>
        </div>

        <div className="action-param-controls">
          <button
            className="template-btn"
            onClick={handleLoadTemplate}
            disabled={isFetching || !ACTION_TEMPLATES[nodeData.actionType]}
            title="Load built-in parameter template"
          >
            📋 Template
          </button>
          <button
            className="template-btn"
            onClick={handleFetchSchema}
            disabled={isFetching || !ros || !nodeData.actionType}
            title="Introspect goal message fields live from ROS"
          >
            {isFetching ? '⏳ Fetching…' : '🔍 Fetch Schema'}
          </button>
        </div>

        {isFetching && (
          <div className="param-loading">Fetching goal schema from ROS…</div>
        )}

        <div className="action-param-editor-container">
          <textarea
            className="param-json-editor"
            value={parameterJson}
            onChange={(e) => setParameterJson(e.target.value)}
            placeholder="Enter JSON parameters…"
            spellCheck={false}
            disabled={isFetching}
          />
        </div>

        {error && <div className="param-error">{error}</div>}

        <div className="action-param-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={isFetching}>
            Save Parameters
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionParameterEditor;
