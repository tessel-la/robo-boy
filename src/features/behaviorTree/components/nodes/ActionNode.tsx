import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ROSActionNodeData, ExecutionStatus } from '../../types';
import './NodeStyles.css';

const ActionNode: React.FC<NodeProps<ROSActionNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;

  return (
    <div className={`bt-node bt-action-node status-${statusClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      
      <div className="bt-node-header">
        <span className="bt-node-icon">⚡</span>
        <span className="bt-node-type">Action</span>
      </div>
      
      <div className="bt-node-content">
        <div className="bt-node-label" title={data.label}>
          {data.label}
        </div>
        <div className="bt-node-detail" title={data.actionName}>
          {data.actionName}
        </div>
        {data.actionType && (
          <div className="bt-node-subdetail" title={data.actionType}>
            {data.actionType}
          </div>
        )}
      </div>
      
      {data.status && (
        <div className="bt-node-status">
          <div className={`bt-status-indicator status-${statusClass}`} />
        </div>
      )}
      
      {/* Action nodes are leaves — no outgoing connections */}
    </div>
  );
};

export default ActionNode;
