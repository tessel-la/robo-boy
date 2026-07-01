import React, { useMemo, useState } from 'react';
import { Edge } from 'reactflow';
import { BehaviorTree, BehaviorTreeNode } from '../types';
import './BehaviorTreeAgentPreview.css';

interface BehaviorTreeAgentPreviewProps {
  tree: BehaviorTree;
  baseline: BehaviorTree | null;
  onReject: () => void;
  onAccept: (mode: 'replace' | 'subtree') => void;
  compact?: boolean;
  showActions?: boolean;
}

type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';
type PreviewMode = 'changes' | 'current' | 'proposed';

export interface TreeChangeSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface TreeDiff {
  proposedNodes: Map<string, ChangeKind>;
  currentNodes: Map<string, ChangeKind>;
  proposedEdges: Map<string, ChangeKind>;
  currentEdges: Map<string, ChangeKind>;
  currentToProposed: Map<string, string>;
}

interface PreviewNode {
  key: string;
  node: BehaviorTreeNode;
  change: ChangeKind;
  source: 'current' | 'proposed';
}

interface PreviewEdge {
  key: string;
  edge: Edge;
  change: ChangeKind;
  sourceKey: string;
  targetKey: string;
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

const edgeSignature = (edge: Edge, nodes: Map<string, BehaviorTreeNode>): string =>
  `${nodeSignature(nodes.get(edge.source) ?? ({ id: edge.source, type: 'unknown', data: { label: edge.source }, position: { x: 0, y: 0 } } as BehaviorTreeNode))}->${nodeSignature(nodes.get(edge.target) ?? ({ id: edge.target, type: 'unknown', data: { label: edge.target }, position: { x: 0, y: 0 } } as BehaviorTreeNode))}`;

export const buildTreeDiff = (baseline: BehaviorTree | null, proposed: BehaviorTree): TreeDiff => {
  const proposedNodes = new Map(proposed.nodes.map(node => [node.id, 'added' as ChangeKind]));
  const currentNodes = new Map((baseline?.nodes ?? []).map(node => [node.id, 'removed' as ChangeKind]));
  const currentToProposed = new Map<string, string>();
  const unmatchedProposed = new Set(proposed.nodes.map(node => node.id));

  baseline?.nodes.forEach(currentNode => {
    const match = proposed.nodes.find(node => unmatchedProposed.has(node.id) && node.id === currentNode.id && node.type === currentNode.type)
      ?? proposed.nodes.find(node => unmatchedProposed.has(node.id) && nodeSignature(node) === nodeSignature(currentNode));
    if (!match) return;
    unmatchedProposed.delete(match.id);
    currentToProposed.set(currentNode.id, match.id);
    const state: ChangeKind = comparableData(currentNode) === comparableData(match) ? 'unchanged' : 'changed';
    currentNodes.set(currentNode.id, state);
    proposedNodes.set(match.id, state);
  });

  const currentNodeById = new Map((baseline?.nodes ?? []).map(node => [node.id, node]));
  const proposedNodeById = new Map(proposed.nodes.map(node => [node.id, node]));
  const currentEdgeSignatures = new Set((baseline?.edges ?? []).map(edge => edgeSignature(edge, currentNodeById)));
  const proposedEdgeSignatures = new Set(proposed.edges.map(edge => edgeSignature(edge, proposedNodeById)));
  const proposedEdges = new Map(proposed.edges.map(edge => [edge.id, currentEdgeSignatures.has(edgeSignature(edge, proposedNodeById)) ? 'unchanged' as ChangeKind : 'added' as ChangeKind]));
  const currentEdges = new Map((baseline?.edges ?? []).map(edge => [edge.id, proposedEdgeSignatures.has(edgeSignature(edge, currentNodeById)) ? 'unchanged' as ChangeKind : 'removed' as ChangeKind]));
  return { proposedNodes, currentNodes, proposedEdges, currentEdges, currentToProposed };
};

export const summarizeTreeChanges = (baseline: BehaviorTree | null, proposed: BehaviorTree): TreeChangeSummary => {
  const diff = buildTreeDiff(baseline, proposed);
  const count = (values: Iterable<ChangeKind>, kind: ChangeKind) => Array.from(values).filter(value => value === kind).length;
  return {
    added: count(diff.proposedNodes.values(), 'added'),
    removed: count(diff.currentNodes.values(), 'removed'),
    changed: count(diff.proposedNodes.values(), 'changed'),
    unchanged: count(diff.proposedNodes.values(), 'unchanged'),
  };
};

const getNodePayload = (node: BehaviorTreeNode): { resource: string; payload: unknown } | null => {
  const data = node.data;
  if ('actionName' in data) return { resource: data.actionName, payload: data.parameters ?? {} };
  if ('serviceName' in data) return { resource: data.serviceName, payload: data.request ?? {} };
  if ('topicName' in data) {
    return 'outputBindings' in data
      ? { resource: data.topicName, payload: { timeout: data.timeout, outputBindings: data.outputBindings } }
      : { resource: data.topicName, payload: data.message ?? {} };
  }
  return null;
};

const BehaviorTreeAgentPreview: React.FC<BehaviorTreeAgentPreviewProps> = ({ tree, baseline, onReject, onAccept, compact = false, showActions = true }) => {
  const [mode, setMode] = useState<PreviewMode>('changes');
  const [zoom, setZoom] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const diff = useMemo(() => buildTreeDiff(baseline, tree), [baseline, tree]);
  const changes = useMemo(() => summarizeTreeChanges(baseline, tree), [baseline, tree]);

  const graph = useMemo(() => {
    const currentNodes = baseline?.nodes ?? [];
    let nodes: PreviewNode[];
    if (mode === 'current') {
      nodes = currentNodes.map(node => ({ key: `current:${node.id}`, node, change: 'unchanged', source: 'current' }));
    } else if (mode === 'proposed') {
      nodes = tree.nodes.map(node => ({ key: `proposed:${node.id}`, node, change: 'unchanged', source: 'proposed' }));
    } else {
      nodes = [
        ...tree.nodes.map(node => ({ key: `proposed:${node.id}`, node, change: diff.proposedNodes.get(node.id) ?? 'added' as ChangeKind, source: 'proposed' as const })),
        ...currentNodes.filter(node => diff.currentNodes.get(node.id) === 'removed').map(node => ({ key: `current:${node.id}`, node, change: 'removed' as ChangeKind, source: 'current' as const })),
      ];
    }

    const nodeKey = (source: 'current' | 'proposed', id: string) => `${source}:${id}`;
    let edges: PreviewEdge[] = [];
    if (mode === 'current') {
      edges = (baseline?.edges ?? []).map(edge => ({ key: `current:${edge.id}`, edge, change: 'unchanged', sourceKey: nodeKey('current', edge.source), targetKey: nodeKey('current', edge.target) }));
    } else if (mode === 'proposed') {
      edges = tree.edges.map(edge => ({ key: `proposed:${edge.id}`, edge, change: 'unchanged', sourceKey: nodeKey('proposed', edge.source), targetKey: nodeKey('proposed', edge.target) }));
    } else {
      const proposedEdges = tree.edges.map(edge => ({ key: `proposed:${edge.id}`, edge, change: diff.proposedEdges.get(edge.id) ?? 'added' as ChangeKind, sourceKey: nodeKey('proposed', edge.source), targetKey: nodeKey('proposed', edge.target) }));
      const removedEdges = (baseline?.edges ?? []).filter(edge => diff.currentEdges.get(edge.id) === 'removed').map(edge => ({
        key: `current:${edge.id}`,
        edge,
        change: 'removed' as ChangeKind,
        sourceKey: diff.currentToProposed.has(edge.source) ? nodeKey('proposed', diff.currentToProposed.get(edge.source)!) : nodeKey('current', edge.source),
        targetKey: diff.currentToProposed.has(edge.target) ? nodeKey('proposed', diff.currentToProposed.get(edge.target)!) : nodeKey('current', edge.target),
      }));
      edges = [...removedEdges, ...proposedEdges];
    }
    return { nodes, edges };
  }, [baseline, diff, mode, tree]);

  const geometry = useMemo(() => {
    const nodeWidth = 132;
    const nodeHeight = 42;
    const padding = 22;
    const minX = Math.min(0, ...graph.nodes.map(item => item.node.position.x));
    const minY = Math.min(0, ...graph.nodes.map(item => item.node.position.y));
    const positions = new Map(graph.nodes.map(item => [item.key, { x: item.node.position.x - minX + padding, y: item.node.position.y - minY + padding }]));
    const canvasWidth = Math.max(280, ...Array.from(positions.values()).map(position => position.x + nodeWidth + padding));
    const canvasHeight = Math.max(140, ...Array.from(positions.values()).map(position => position.y + nodeHeight + padding));
    return { nodeWidth, nodeHeight, positions, canvasWidth, canvasHeight };
  }, [graph.nodes]);

  const selected = graph.nodes.find(item => item.key === selectedKey) ?? null;
  const selectedPayload = selected ? getNodePayload(selected.node) : null;
  const payloadNodes = tree.nodes.map(node => ({ node, payload: getNodePayload(node) })).filter(item => item.payload);

  return <section className="bt-agent-preview" aria-label="Proposed behavior tree changes" data-testid="bt-agent-preview">
    <div className="bt-agent-preview-header">
      <div><span>Review proposal</span><h3>{tree.name}</h3></div>
      <div className="bt-agent-diff" aria-label="Change summary"><span className="added">+{changes.added}</span><span className="changed">~{changes.changed}</span><span className="removed">−{changes.removed}</span></div>
    </div>
    {tree.description && <p className="bt-agent-preview-description">{tree.description}</p>}

    {compact && <div className="bt-agent-preview-on-canvas"><span aria-hidden="true">◎</span><div><strong>Preview active on canvas</strong><small>Keep editing or inspect the highlighted BT behind this panel.</small></div></div>}

    {!compact && <><div className="bt-agent-preview-toolbar">
      <div className="bt-agent-preview-modes" role="group" aria-label="Preview version">
        <button type="button" className={mode === 'changes' ? 'active' : ''} aria-pressed={mode === 'changes'} onClick={() => { setMode('changes'); setSelectedKey(null); }}>Changes</button>
        <button type="button" className={mode === 'current' ? 'active' : ''} aria-pressed={mode === 'current'} disabled={!baseline} onClick={() => { setMode('current'); setSelectedKey(null); }}>Current</button>
        <button type="button" className={mode === 'proposed' ? 'active' : ''} aria-pressed={mode === 'proposed'} onClick={() => { setMode('proposed'); setSelectedKey(null); }}>Proposed</button>
      </div>
      <div className="bt-agent-preview-zoom" aria-label="Preview zoom">
        <button type="button" onClick={() => setZoom(value => Math.max(.7, value - .15))} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => setZoom(value => Math.min(1.8, value + .15))} aria-label="Zoom in">+</button>
      </div>
    </div>

    {mode === 'changes' && <div className="bt-agent-preview-legend"><span className="added">Added</span><span className="changed">Modified</span><span className="removed">Removed</span><span>Tap a node to inspect</span></div>}
    <div className="bt-agent-preview-canvas">
      <svg style={{ width: `${zoom * 100}%` }} viewBox={`0 0 ${geometry.canvasWidth} ${geometry.canvasHeight}`} role="img" aria-label={`Preview of ${tree.name}`}>
        {graph.edges.map(item => {
          const source = geometry.positions.get(item.sourceKey);
          const target = geometry.positions.get(item.targetKey);
          if (!source || !target) return null;
          return <line className={item.change} key={item.key} x1={source.x + geometry.nodeWidth / 2} y1={source.y + geometry.nodeHeight} x2={target.x + geometry.nodeWidth / 2} y2={target.y} />;
        })}
        {graph.nodes.map(item => {
          const position = geometry.positions.get(item.key);
          if (!position) return null;
          return <g key={item.key} className={`bt-agent-preview-node ${item.change}${selectedKey === item.key ? ' selected' : ''}`} transform={`translate(${position.x} ${position.y})`} role="button" tabIndex={0} aria-label={`${item.node.data.label}, ${item.change}`} onClick={() => setSelectedKey(item.key)} onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && setSelectedKey(item.key)}>
            <rect width={geometry.nodeWidth} height={geometry.nodeHeight} rx="8" />
            <text x={geometry.nodeWidth / 2} y="17" textAnchor="middle">{item.node.data.label.slice(0, 20)}</text>
            <text className="type" x={geometry.nodeWidth / 2} y="32" textAnchor="middle">{item.node.type}</text>
          </g>;
        })}
      </svg>
    </div>

    {selected && <div className={`bt-agent-node-inspector ${selected.change}`}>
      <div><strong>{selected.node.data.label}</strong><span>{selected.change} · {selected.node.type}</span></div>
      {selectedPayload ? <><code>{selectedPayload.resource}</code><pre>{JSON.stringify(selectedPayload.payload, null, 2)}</pre></> : <p>No runtime parameters for this control node.</p>}
    </div>}</>}

    {payloadNodes.length > 0 && <div className="bt-agent-preview-inputs"><strong>All proposed inputs</strong>{payloadNodes.map(({ node, payload }) => <details key={node.id}><summary><span>{node.data.label}</span><code>{payload?.resource}</code></summary><pre>{JSON.stringify(payload?.payload, null, 2)}</pre></details>)}</div>}

    {showActions && <div className="bt-agent-review-actions"><button type="button" className="reject" onClick={onReject}>Reject changes</button><button type="button" className="secondary" onClick={() => onAccept('subtree')}>Accept as subtree</button><button type="button" onClick={() => onAccept('replace')}>Accept replacement</button></div>}
  </section>;
};

export default BehaviorTreeAgentPreview;
