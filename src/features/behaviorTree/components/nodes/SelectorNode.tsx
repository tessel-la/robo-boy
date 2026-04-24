import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ControlFlowNodeData, ExecutionStatus } from '../../types';
import './NodeStyles.css';

const SelectorNode: React.FC<NodeProps<ControlFlowNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;

  return (
    <div className={`bt-node bt-selector-node status-${statusClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      
      <div className="bt-node-header">
        <span className="bt-node-icon">?</span>
        <span className="bt-node-type">Selector</span>
      </div>
      
      <div className="bt-node-content">
        <div className="bt-node-label">{data.label}</div>
        {data.description && (
          <div className="bt-node-subdetail">{data.description}</div>
        )}
      </div>
      
      {data.status && (
        <div className="bt-node-status">
          <div className={`bt-status-indicator status-${statusClass}`} />
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="bt-handle" />
    </div>
  );
};

export default SelectorNode;

