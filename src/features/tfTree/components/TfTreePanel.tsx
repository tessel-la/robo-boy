import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Ros } from 'roslib';
import { FaExclamationTriangle, FaExpand, FaFilter, FaPause, FaPlay, FaSearch } from 'react-icons/fa';

import {
  TfTransformRecord,
  computeConnectedComponents,
  getTfGraphDiagnostics,
  getTransformAgeMs,
  isTransformStale,
} from '../tfTreeModel';
import { layoutTfTree } from '../tfTreeLayout';
import { useTfTree } from '../useTfTree';
import './TfTreePanel.css';

const STALE_AFTER_MS = 5_000;

interface TfTreePanelProps {
  ros: Ros | null;
  isActive: boolean;
}

type Selection = { type: 'node'; frame: string } | { type: 'edge'; childFrame: string } | null;

const formatAge = (ageMs: number) => {
  if (ageMs < 1_000) return `${Math.round(ageMs)} ms`;
  if (ageMs < 60_000) return `${(ageMs / 1_000).toFixed(1)} s`;
  return `${(ageMs / 60_000).toFixed(1)} min`;
};

const formatTimestamp = (timestampMs: number | null, fallbackMs: number) =>
  new Date(timestampMs ?? fallbackMs).toLocaleString();

const TfTreePanelInner: React.FC<TfTreePanelProps> = ({ ros, isActive }) => {
  const { state, isPaused, pause, resume } = useTfTree(ros);
  const { fitView, setCenter } = useReactFlow();
  const [nowMs, setNowMs] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [showStatic, setShowStatic] = useState(true);
  const [highlightStale, setHighlightStale] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    if (!isActive) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const diagnostics = useMemo(() => getTfGraphDiagnostics(state), [state]);
  const positions = useMemo(() => layoutTfTree(state), [state]);
  const normalizedFilter = filterQuery.trim().toLowerCase();

  const visibleTransforms = useMemo(() => {
    const transforms = [...state.transformsByChild.values()].filter(
      transform => showStatic || transform.source !== 'static'
    );
    if (!normalizedFilter) return transforms;
    return transforms.filter(
      transform =>
        transform.parentFrame.toLowerCase().includes(normalizedFilter) ||
        transform.childFrame.toLowerCase().includes(normalizedFilter)
    );
  }, [normalizedFilter, showStatic, state.transformsByChild]);

  const visibleFrames = useMemo(() => {
    const frames = new Set<string>();
    if (showStatic && !normalizedFilter) {
      state.knownFrames.forEach(frame => frames.add(frame));
    } else if (normalizedFilter) {
      state.knownFrames.forEach(frame => {
        if (frame.toLowerCase().includes(normalizedFilter)) frames.add(frame);
      });
    }
    visibleTransforms.forEach(transform => {
      frames.add(transform.parentFrame);
      frames.add(transform.childFrame);
    });
    return frames;
  }, [normalizedFilter, showStatic, state.knownFrames, visibleTransforms]);

  const visibleComponentCount = useMemo(
    () =>
      computeConnectedComponents({
        transformsByChild: new Map(visibleTransforms.map(transform => [transform.childFrame, transform])),
        observedParentsByChild: new Map(),
        knownFrames: visibleFrames,
      }).length,
    [visibleFrames, visibleTransforms]
  );

  const incomingByFrame = useMemo(
    () => new Map(visibleTransforms.map(transform => [transform.childFrame, transform])),
    [visibleTransforms]
  );

  const searchMatch = searchQuery.trim().toLowerCase();
  const nodes = useMemo<Node[]>(() => {
    return [...visibleFrames].sort().map(frame => {
      const incoming = incomingByFrame.get(frame);
      const stale = incoming ? isTransformStale(incoming, nowMs, STALE_AFTER_MS) : false;
      const isSearchMatch = Boolean(searchMatch) && frame.toLowerCase().includes(searchMatch);
      const selected = selection?.type === 'node' && selection.frame === frame;
      const stateClass =
        incoming?.source === 'static' ? 'static' : stale && highlightStale ? 'stale' : incoming ? 'healthy' : 'root';

      return {
        id: frame,
        data: { label: frame },
        position: positions.get(frame) ?? { x: 0, y: 0 },
        className: `tf-frame-node tf-frame-node--${stateClass}${isSearchMatch ? ' tf-frame-node--match' : ''}`,
        selected,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        draggable: false,
        selectable: true,
        width: 172,
        height: 48,
      };
    });
  }, [highlightStale, incomingByFrame, nowMs, positions, searchMatch, selection, visibleFrames]);

  const edges = useMemo<Edge[]>(
    () =>
      visibleTransforms.map(transform => {
        const stale = isTransformStale(transform, nowMs, STALE_AFTER_MS);
        const selected = selection?.type === 'edge' && selection.childFrame === transform.childFrame;
        const ageLabel = transform.source === 'static' ? 'STATIC' : formatAge(getTransformAgeMs(transform, nowMs));

        return {
          id: `tf:${transform.parentFrame}:${transform.childFrame}`,
          source: transform.parentFrame,
          target: transform.childFrame,
          label: ageLabel,
          selected,
          animated: transform.source === 'dynamic' && !isPaused,
          markerEnd: { type: MarkerType.ArrowClosed },
          className: `tf-transform-edge tf-transform-edge--${transform.source}${stale && highlightStale ? ' tf-transform-edge--stale' : ''}`,
          data: transform,
          labelBgPadding: [5, 3] as [number, number],
          labelBgBorderRadius: 3,
        };
      }),
    [highlightStale, isPaused, nowMs, selection, visibleTransforms]
  );

  const selectedTransform: TfTransformRecord | undefined =
    selection?.type === 'edge' ? state.transformsByChild.get(selection.childFrame) : undefined;

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const frame =
      [...visibleFrames].sort().find(candidate => candidate.toLowerCase() === query) ??
      [...visibleFrames].sort().find(candidate => candidate.toLowerCase().includes(query));
    if (!frame) return;
    const position = positions.get(frame);
    setSelection({ type: 'node', frame });
    if (position) setCenter(position.x + 86, position.y + 24, { zoom: 1.35, duration: 450 });
  };

  const warningCount = diagnostics.cycles.length + diagnostics.multipleParents.length;

  return (
    <section className="tf-tree-panel" data-testid="tf-tree-panel">
      <header className="tf-tree-toolbar">
        <div className="tf-tree-toolbar__group">
          <button
            type="button"
            className={isPaused ? 'active' : ''}
            onClick={isPaused ? resume : pause}
            title={isPaused ? 'Resume live TF updates' : 'Pause live TF updates'}
            aria-label={isPaused ? 'Resume live TF updates' : 'Pause live TF updates'}
          >
            {isPaused ? <FaPlay /> : <FaPause />}
          </button>
          <button
            type="button"
            onClick={() => fitView({ padding: 0.15, duration: 350 })}
            title="Fit TF graph to view"
            aria-label="Fit TF graph to view"
          >
            <FaExpand />
          </button>
        </div>

        <form className="tf-tree-search" onSubmit={handleSearch}>
          <FaSearch aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search frame"
            aria-label="Search TF frame"
          />
        </form>

        <label className="tf-tree-filter">
          <FaFilter aria-hidden="true" />
          <input
            value={filterQuery}
            onChange={event => setFilterQuery(event.target.value)}
            placeholder="Filter frames"
            aria-label="Filter TF frames"
          />
        </label>

        <label className="tf-tree-toggle">
          <input type="checkbox" checked={highlightStale} onChange={event => setHighlightStale(event.target.checked)} />
          Highlight stale
        </label>
        <label className="tf-tree-toggle">
          <input type="checkbox" checked={showStatic} onChange={event => setShowStatic(event.target.checked)} />
          Static TF
        </label>

        <div className="tf-tree-summary" aria-label="TF graph summary">
          <span>{visibleFrames.size} frames</span>
          <span>{visibleTransforms.length} transforms</span>
          <span>{visibleComponentCount} trees</span>
        </div>
      </header>

      {warningCount > 0 && (
        <div className="tf-tree-warnings" role="alert">
          <FaExclamationTriangle aria-hidden="true" />
          <div>
            {diagnostics.multipleParents.map(warning => (
              <span key={`parents:${warning.childFrame}`}>
                {warning.childFrame} has multiple observed parents: {warning.parentFrames.join(', ')}
              </span>
            ))}
            {diagnostics.cycles.map(cycle => (
              <span key={`cycle:${cycle.join(':')}`}>{`Cycle detected: ${cycle.join(' -> ')} -> ${cycle[0]}`}</span>
            ))}
          </div>
        </div>
      )}

      <div className="tf-tree-workspace">
        <div className="tf-tree-canvas" data-testid="tf-tree-canvas">
          {nodes.length === 0 && (
            <div className="tf-tree-empty">
              {state.transformsByChild.size === 0
                ? 'Waiting for /tf and /tf_static…'
                : 'No transforms match this filter'}
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            minZoom={0.08}
            maxZoom={2.5}
            nodesConnectable={false}
            nodesDraggable={false}
            elementsSelectable
            onNodeClick={(_event, node) => setSelection({ type: 'node', frame: node.id })}
            onEdgeClick={(_event, edge) => {
              const transform = edge.data as TfTransformRecord | undefined;
              if (transform) setSelection({ type: 'edge', childFrame: transform.childFrame });
            }}
            onPaneClick={() => setSelection(null)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="tf-tree-details" aria-label="TF selection details">
          <h2>Details</h2>
          {!selection && <p className="tf-tree-details__empty">Select a frame or transform.</p>}
          {selection?.type === 'node' && (
            <dl>
              <dt>Frame</dt>
              <dd>{selection.frame}</dd>
              <dt>Parent</dt>
              <dd>{state.transformsByChild.get(selection.frame)?.parentFrame ?? 'Root'}</dd>
              <dt>Children</dt>
              <dd>
                {[...state.transformsByChild.values()]
                  .filter(transform => transform.parentFrame === selection.frame)
                  .map(transform => transform.childFrame)
                  .sort()
                  .join(', ') || 'None'}
              </dd>
            </dl>
          )}
          {selectedTransform && (
            <dl>
              <dt>Parent</dt>
              <dd>{selectedTransform.parentFrame}</dd>
              <dt>Child</dt>
              <dd>{selectedTransform.childFrame}</dd>
              <dt>Source</dt>
              <dd>{selectedTransform.source === 'static' ? '/tf_static' : '/tf'}</dd>
              <dt>Last published</dt>
              <dd>{formatTimestamp(selectedTransform.messageTimestampMs, selectedTransform.receivedAtMs)}</dd>
              <dt>Age</dt>
              <dd>
                {selectedTransform.source === 'static'
                  ? 'Static'
                  : formatAge(getTransformAgeMs(selectedTransform, nowMs))}
              </dd>
              <dt>Status</dt>
              <dd>
                {selectedTransform.source === 'static'
                  ? 'Static'
                  : isTransformStale(selectedTransform, nowMs, STALE_AFTER_MS)
                    ? 'Stale'
                    : 'Healthy'}
              </dd>
            </dl>
          )}
        </aside>
      </div>
    </section>
  );
};

const TfTreePanel: React.FC<TfTreePanelProps> = props => (
  <ReactFlowProvider>
    <TfTreePanelInner {...props} />
  </ReactFlowProvider>
);

export default TfTreePanel;
