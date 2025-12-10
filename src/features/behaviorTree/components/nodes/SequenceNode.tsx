import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ControlFlowNodeData, ExecutionStatus } from '../../types';
import './NodeStyles.css';

const SequenceNode: React.FC<NodeProps<ControlFlowNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;

  return (
    <div className={`bt-node bt-sequence-node status-${statusClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      
      <div className="bt-node-header">
        <span className="bt-node-icon">→</span>
        <span className="bt-node-type">Sequence</span>
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
      
      <Handle type="source" position={Position.Bottom} className="bt-handle" id="out-1" />
      <Handle type="source" position={Position.Bottom} className="bt-handle bt-handle-multi" id="out-2" style={{ left: '40%' }} />
      <Handle type="source" position={Position.Bottom} className="bt-handle bt-handle-multi" id="out-3" style={{ left: '60%' }} />
    </div>
  );
};

export default SequenceNode;

