import React from 'react';
import { Handle, NodeProps, Position } from 'reactflow';

import { ExecutionStatus, SubtreeNodeData } from '../../types';
import './NodeStyles.css';

const SubtreeNode: React.FC<NodeProps<SubtreeNodeData>> = ({ data, selected }) => {
  const statusClass = data.status || ExecutionStatus.Idle;
  const nodeCount = data.tree.nodes.length;

  return (
    <div
      className={`bt-node bt-subtree-node status-${statusClass} ${selected ? 'selected' : ''} ${
        data.isHighlighted ? 'clicked' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="bt-handle" />

      <div className="bt-node-header">
        <span className="bt-node-icon">▣</span>
        <span className="bt-node-type">Subtree</span>
      </div>

      <div className="bt-node-content">
        <div className="bt-node-label" title={data.label}>
          {data.label}
        </div>
        <div className="bt-node-detail">
          {nodeCount} node{nodeCount === 1 ? '' : 's'}
        </div>
        <div className="bt-node-subdetail" title={data.tree.name}>
          {data.tree.name}
        </div>
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

export default SubtreeNode;
