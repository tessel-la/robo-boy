import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ROSServiceNodeData, ExecutionStatus } from '../../types';
import './NodeStyles.css';

const ServiceNode: React.FC<NodeProps<ROSServiceNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;

  return (
    <div
      className={`bt-node bt-service-node status-${statusClass} ${selected ? 'selected' : ''} ${
        data.isHighlighted ? 'clicked' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="bt-handle" />
      
      <div className="bt-node-header">
        <span className="bt-node-icon">🔧</span>
        <span className="bt-node-type">Service</span>
      </div>
      
      <div className="bt-node-content">
        <div className="bt-node-label" title={data.label}>
          {data.label}
        </div>
        <div className="bt-node-detail" title={data.serviceName}>
          {data.serviceName}
        </div>
        {data.serviceType && (
          <div className="bt-node-subdetail" title={data.serviceType}>
            {data.serviceType}
          </div>
        )}
      </div>
      
      {data.status && (
        <div className="bt-node-status">
          <div className={`bt-status-indicator status-${statusClass}`} />
        </div>
      )}
      
      {/* Service nodes are leaves — no outgoing connections */}
    </div>
  );
};

export default ServiceNode;
