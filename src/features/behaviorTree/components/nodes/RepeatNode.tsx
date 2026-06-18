import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ControlFlowNodeData, ExecutionStatus } from '../../types';
import './NodeStyles.css';

const getLimitLabel = (limit?: number): string => {
  if (limit === -1) return 'Infinite';
  return `${Math.max(1, limit ?? 3)} repeat${Math.max(1, limit ?? 3) === 1 ? '' : 's'}`;
};

const RepeatNode: React.FC<NodeProps<ControlFlowNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;

  return (
    <div
      className={`bt-node bt-repeat-node status-${statusClass} ${selected ? 'selected' : ''} ${
        data.isHighlighted ? 'clicked' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="bt-handle" />

      <div className="bt-node-header">
        <span className="bt-node-icon">⟳</span>
        <span className="bt-node-type">Repeat</span>
      </div>

      <div className="bt-node-content">
        <div className="bt-node-label">{data.label}</div>
        <div className="bt-node-detail">{getLimitLabel(data.iterationLimit)}</div>
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

export default RepeatNode;
