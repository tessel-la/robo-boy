import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ROSServiceNodeData, ExecutionStatus } from '../../types';
import './NodeStyles.css';

const ServiceNode: React.FC<NodeProps<ROSServiceNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;

  return (
    <div className={`bt-node bt-service-node status-${statusClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      
      <div className="bt-node-header">
        <span className="bt-node-icon">🔧</span>
        <span className="bt-node-type">Service</span>
      </div>
      
      <div className="bt-node-content">
        <div className="bt-node-label">{data.label}</div>
        <div className="bt-node-detail">{data.serviceName}</div>
        {data.serviceType && (
          <div className="bt-node-subdetail">{data.serviceType}</div>
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

export default ServiceNode;

