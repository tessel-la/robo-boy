import React from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { ExecutionStatus, ROSSubscriberNodeData } from '../../types';
import './NodeStyles.css';

const SubscriberNode: React.FC<NodeProps<ROSSubscriberNodeData>> = ({ data, selected }) => {
  const status = data.status || ExecutionStatus.Idle;
  return (
    <div className={`bt-node bt-subscriber-node status-${status} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      <div className="bt-node-header"><span className="bt-node-icon">IN</span><span>Subscriber</span></div>
      <div className="bt-node-content">
        <div className="bt-node-label">{data.label}</div>
        <div className="bt-node-detail">{data.topicName}</div>
        <div className="bt-node-subdetail">{data.outputBindings.length} mapping(s)</div>
      </div>
    </div>
  );
};

export default SubscriberNode;
