import React, { useMemo } from 'react';
import { BehaviorTree, BehaviorTreeNode } from '../types';
import './BehaviorTreeAgentPreview.css';

interface BehaviorTreeAgentPreviewProps {
  tree: BehaviorTree;
  baseline: BehaviorTree | null;
  onReject: () => void;
  onAccept: (mode: 'replace' | 'subtree') => void;
}

export interface TreeChangeSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

const nodeSignature = (node: BehaviorTreeNode): string => {
  const data = node.data;
  const resource = 'actionName' in data
    ? data.actionName
    : 'serviceName' in data
      ? data.serviceName
      : 'topicName' in data
        ? data.topicName
        : data.label;
  return `${node.type}:${resource || data.label}`;
};

const comparableData = (node: BehaviorTreeNode): string => {
  const data = { ...node.data } as Record<string, unknown>;
  delete data.status;
  delete data.isHighlighted;
  return JSON.stringify(data);
};

export const summarizeTreeChanges = (
  baseline: BehaviorTree | null,
  proposed: BehaviorTree
): TreeChangeSummary => {
  if (!baseline) return { added: proposed.nodes.length, removed: 0, changed: 0, unchanged: 0 };
  const unmatched = [...proposed.nodes];
  let changed = 0;
  let unchanged = 0;

  baseline.nodes.forEach(currentNode => {
    const exactIdIndex = unmatched.findIndex(node => node.id === currentNode.id && node.type === currentNode.type);
    const semanticIndex = unmatched.findIndex(node => nodeSignature(node) === nodeSignature(currentNode));
    const matchIndex = exactIdIndex >= 0 ? exactIdIndex : semanticIndex;
    if (matchIndex < 0) return;
    const [match] = unmatched.splice(matchIndex, 1);
    if (comparableData(currentNode) === comparableData(match)) unchanged += 1;
    else changed += 1;
  });

  return {
    added: unmatched.length,
    removed: Math.max(0, baseline.nodes.length - changed - unchanged),
    changed,
    unchanged,
  };
};

const getNodePayload = (node: BehaviorTreeNode): { resource: string; payload: unknown } | null => {
  const data = node.data;
  if ('actionName' in data) return { resource: data.actionName, payload: data.parameters ?? {} };
  if ('serviceName' in data) return { resource: data.serviceName, payload: data.request ?? {} };
  if ('topicName' in data) return { resource: data.topicName, payload: data.message ?? {} };
  return null;
};

const BehaviorTreeAgentPreview: React.FC<BehaviorTreeAgentPreviewProps> = ({
  tree,
  baseline,
  onReject,
  onAccept,
}) => {
  const changes = useMemo(() => summarizeTreeChanges(baseline, tree), [baseline, tree]);
  const geometry = useMemo(() => {
    const width = 132;
    const height = 42;
    const padding = 18;
    const minX = Math.min(0, ...tree.nodes.map(node => node.position.x));
    const minY = Math.min(0, ...tree.nodes.map(node => node.position.y));
    const positions = new Map(tree.nodes.map(node => [node.id, {
      x: node.position.x - minX + padding,
      y: node.position.y - minY + padding,
    }]));
    const canvasWidth = Math.max(260, ...Array.from(positions.values()).map(position => position.x + width + padding));
    const canvasHeight = Math.max(120, ...Array.from(positions.values()).map(position => position.y + height + padding));
    return { width, height, positions, canvasWidth, canvasHeight };
  }, [tree]);
  const payloadNodes = tree.nodes.map(node => ({ node, payload: getNodePayload(node) })).filter(item => item.payload);

  return (
    <section className="bt-agent-preview" aria-label="Proposed behavior tree changes" data-testid="bt-agent-preview">
      <div className="bt-agent-preview-header">
        <div><span>Review proposal</span><h3>{tree.name}</h3></div>
        <div className="bt-agent-diff" aria-label="Change summary">
          <span className="added">+{changes.added}</span>
          <span className="changed">~{changes.changed}</span>
          <span className="removed">−{changes.removed}</span>
        </div>
      </div>
      {tree.description && <p className="bt-agent-preview-description">{tree.description}</p>}

      <div className="bt-agent-preview-canvas">
        <svg viewBox={`0 0 ${geometry.canvasWidth} ${geometry.canvasHeight}`} role="img" aria-label={`Preview of ${tree.name}`}>
          {tree.edges.map(edge => {
            const source = geometry.positions.get(edge.source);
            const target = geometry.positions.get(edge.target);
            if (!source || !target) return null;
            return <line key={edge.id} x1={source.x + geometry.width / 2} y1={source.y + geometry.height} x2={target.x + geometry.width / 2} y2={target.y} />;
          })}
          {tree.nodes.map(node => {
            const position = geometry.positions.get(node.id);
            if (!position) return null;
            return <g key={node.id} transform={`translate(${position.x} ${position.y})`}>
              <rect width={geometry.width} height={geometry.height} rx="8" />
              <text x={geometry.width / 2} y="17" textAnchor="middle">{node.data.label.slice(0, 20)}</text>
              <text className="type" x={geometry.width / 2} y="32" textAnchor="middle">{node.type}</text>
            </g>;
          })}
        </svg>
      </div>

      {payloadNodes.length > 0 && <div className="bt-agent-preview-inputs">
        <strong>Action inputs</strong>
        {payloadNodes.map(({ node, payload }) => <details key={node.id}>
          <summary><span>{node.data.label}</span><code>{payload?.resource}</code></summary>
          <pre>{JSON.stringify(payload?.payload, null, 2)}</pre>
        </details>)}
      </div>}

      <div className="bt-agent-review-actions">
        <button type="button" className="reject" onClick={onReject}>Reject changes</button>
        <button type="button" className="secondary" onClick={() => onAccept('subtree')}>Accept as subtree</button>
        <button type="button" onClick={() => onAccept('replace')}>Accept replacement</button>
      </div>
    </section>
  );
};

export default BehaviorTreeAgentPreview;

