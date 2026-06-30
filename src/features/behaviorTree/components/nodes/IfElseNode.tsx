import React from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { ExecutionStatus, IfElseNodeData } from '../../types';
import './NodeStyles.css';

const IfElseNode: React.FC<NodeProps<IfElseNodeData>> = ({ data, selected }) => {
  const status = data.status || ExecutionStatus.Idle;
  return (
    <div className={`bt-node bt-if-else-node status-${status} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="bt-handle" />
      <div className="bt-node-header"><span className="bt-node-icon">?</span><span>If / Else</span></div>
      <div className="bt-node-content">
        <div className="bt-node-label">{data.variable || 'Select variable'}</div>
        <div className="bt-node-detail">{data.operator}</div>
      </div>
      <Handle id="then" type="source" position={Position.Bottom} className="bt-handle bt-handle-then" style={{ left: '30%' }} />
      <Handle id="else" type="source" position={Position.Bottom} className="bt-handle bt-handle-else" style={{ left: '70%' }} />
      <div className="bt-branch-label bt-branch-label-then">Then</div>
      <div className="bt-branch-label bt-branch-label-else">Else</div>
    </div>
  );
};

export default IfElseNode;
