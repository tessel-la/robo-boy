import React from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { ExecutionStatus, TimeoutNodeData } from '../../types';
import './NodeStyles.css';

const TimeoutNode: React.FC<NodeProps<TimeoutNodeData>> = ({ data, selected }) => {
  const status = data.status || ExecutionStatus.Idle;
  return (
    <div className={`bt-node bt-timeout-node status-${status} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      <div className="bt-node-header"><span className="bt-node-icon">T</span><span>Timeout</span></div>
      <div className="bt-node-content">
        <div className="bt-node-label">{data.label}</div>
        <div className="bt-node-detail">{Math.max(1, data.timeout)} ms</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="bt-handle" />
    </div>
  );
};

export default TimeoutNode;
