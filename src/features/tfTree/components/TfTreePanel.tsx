import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { FaTimes } from 'react-icons/fa';

import {
  TfTransformRecord,
  computeConnectedComponents,
  getTfGraphDiagnostics,
  getTransformAgeMs,
  isTransformStale,
  quaternionToEulerRpy,
} from '../tfTreeModel';
import { layoutTfTree } from '../tfTreeLayout';
import { useTfTree } from '../useTfTree';
import TfCalculator from './TfCalculator';
import TfTreeControls, { TfVisibleTree } from './TfTreeControls';
import type { TreePanelSearchResult } from '../../treePanel/components/TreePanelSearch';
import './TfTreePanel.css';

const STALE_AFTER_MS = 5_000;
const COMPACT_PANEL_WIDTH = 520;

interface TfTreePanelProps {
  ros: Ros | null;
  isActive: boolean;
}

type Selection = { type: 'node'; frame: string } | { type: 'edge'; childFrame: string } | null;
type CalculatorPick = 'source' | 'target' | null;

const formatAge = (ageMs: number) => {
  if (ageMs < 1_000) return `${Math.round(ageMs)} ms`;
  if (ageMs < 60_000) return `${(ageMs / 1_000).toFixed(1)} s`;
  return `${(ageMs / 60_000).toFixed(1)} min`;
};

const formatTimestamp = (timestampMs: number | null, fallbackMs: number) =>
  new Date(timestampMs ?? fallbackMs).toLocaleString();

const formatVector = (values: number[], digits = 4) => values.map(value => value.toFixed(digits)).join(', ');

const TfTreePanelInner: React.FC<TfTreePanelProps> = ({ ros, isActive }) => {
  const { state, isPaused, pause, resume, refresh } = useTfTree(ros);
  const { fitView, setCenter } = useReactFlow();
  const panelRef = useRef<HTMLElement>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [showStatic, setShowStatic] = useState(true);
  const [highlightStale, setHighlightStale] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorSource, setCalculatorSource] = useState('');
  const [calculatorTarget, setCalculatorTarget] = useState('');
  const [calculatorPick, setCalculatorPick] = useState<CalculatorPick>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const compactByViewport =
    typeof window !== 'undefined' && window.matchMedia?.(`(max-width: ${COMPACT_PANEL_WIDTH}px)`).matches;
  const isCompact = panelWidth > 0 ? panelWidth <= COMPACT_PANEL_WIDTH : compactByViewport;
  const hasMeasuredPanel = panelWidth > 0;

  useEffect(() => {
    if (!isActive) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) setMenuOpen(false);
  }, [isActive]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const updateWidth = (width: number) => {
      if (width > 0) setPanelWidth(width);
    };
    updateWidth(panel.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => updateWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasMeasuredPanel) return;
    fitView({ padding: 0.18, duration: 250, maxZoom: 1.2 });
  }, [fitView, hasMeasuredPanel, isCompact]);

  const diagnostics = useMemo(() => getTfGraphDiagnostics(state), [state]);
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

  const visibleState = useMemo(
    () => ({
      transformsByChild: new Map(visibleTransforms.map(transform => [transform.childFrame, transform])),
      observedParentsByChild: new Map<string, Set<string>>(),
      knownFrames: visibleFrames,
    }),
    [visibleFrames, visibleTransforms]
  );
  const nodeWidth = isCompact ? 154 : 172;
  const nodeHeight = isCompact ? 44 : 48;
  const positions = useMemo(
    () => layoutTfTree(visibleState, { compact: isCompact }),
    [isCompact, layoutRevision, visibleState]
  );
  const incomingByFrame = visibleState.transformsByChild;

  const visibleTrees = useMemo<TfVisibleTree[]>(() => {
    return computeConnectedComponents(visibleState).map(frames => {
      const frameSet = new Set(frames);
      const childFrames = new Set(
        visibleTransforms
          .filter(transform => frameSet.has(transform.parentFrame) && frameSet.has(transform.childFrame))
          .map(transform => transform.childFrame)
      );
      const rootFrame = frames.find(frame => !childFrames.has(frame)) ?? frames[0];
      return { id: frames.join('\u0000'), rootFrame, frames };
    });
  }, [visibleState, visibleTransforms]);

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
        width: nodeWidth,
        height: nodeHeight,
      };
    });
  }, [highlightStale, incomingByFrame, nodeHeight, nodeWidth, nowMs, positions, searchMatch, selection, visibleFrames]);

  const edges = useMemo<Edge[]>(
    () =>
      visibleTransforms.map(transform => {
        const stale = isTransformStale(transform, nowMs, STALE_AFTER_MS);
        const selected = selection?.type === 'edge' && selection.childFrame === transform.childFrame;
        const edgeColor = selected
          ? '#ffb300'
          : stale && highlightStale
            ? 'var(--tf-stale)'
            : transform.source === 'static'
              ? 'var(--tf-static)'
              : 'var(--tf-healthy)';
        return {
          id: `tf:${transform.parentFrame}:${transform.childFrame}`,
          source: transform.parentFrame,
          target: transform.childFrame,
          label: transform.source === 'static' ? 'STATIC' : 'DYNAMIC',
          selected,
          animated: transform.source === 'dynamic' && !isPaused,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
            width: selected ? 12 : 16,
            height: selected ? 12 : 16,
          },
          className: `tf-transform-edge tf-transform-edge--${transform.source}${stale && highlightStale ? ' tf-transform-edge--stale' : ''}`,
          data: transform,
          labelBgPadding: [5, 3] as [number, number],
          labelBgBorderRadius: 3,
        };
      }),
    [highlightStale, isPaused, nowMs, selection, visibleTransforms]
  );

  useEffect(() => {
    if (selection?.type === 'node' && !visibleFrames.has(selection.frame)) setSelection(null);
    if (selection?.type === 'edge' && !incomingByFrame.has(selection.childFrame)) setSelection(null);
  }, [incomingByFrame, selection, visibleFrames]);

  const searchResults = useMemo<TreePanelSearchResult<string>[]>(() => {
    if (!searchMatch) return [];
    return [...visibleFrames]
      .filter(frame => frame.toLowerCase().includes(searchMatch))
      .sort()
      .map(frame => {
        const incoming = incomingByFrame.get(frame);
        return {
          id: frame,
          label: frame,
          value: frame,
          detail: incoming ? `Parent: ${incoming.parentFrame}` : 'Root frame',
          badge: incoming?.source === 'static' ? 'Static' : incoming ? 'Dynamic' : 'Root',
        };
      });
  }, [incomingByFrame, searchMatch, visibleFrames]);

  const handleSelectFrame = (frame: string) => {
    const position = positions.get(frame);
    setSelection({ type: 'node', frame });
    if (position) {
      setCenter(position.x + nodeWidth / 2, position.y + nodeHeight / 2, {
        zoom: 1.35,
        duration: 450,
      });
    }
  };

  const handleFocusTree = (tree: TfVisibleTree) => {
    const frameSet = new Set(tree.frames);
    const treeNodes = nodes.filter(node => frameSet.has(node.id));
    setMenuOpen(false);
    fitView({ nodes: treeNodes, padding: 0.22, duration: 400, maxZoom: 1.4 });
  };

  const selectedTransform: TfTransformRecord | undefined =
    selection?.type === 'edge' ? state.transformsByChild.get(selection.childFrame) : undefined;
  const selectedEuler = quaternionToEulerRpy(selectedTransform?.rotation ?? null);

  const handleArrange = () => {
    setLayoutRevision(revision => revision + 1);
    fitView({ padding: 0.18, duration: 450, maxZoom: 1.25 });
  };

  const handleNodeClick = (frame: string) => {
    if (calculatorPick === 'source') {
      setCalculatorSource(frame);
      setCalculatorPick(null);
      return;
    }
    if (calculatorPick === 'target') {
      setCalculatorTarget(frame);
      setCalculatorPick(null);
      return;
    }
    setSelection({ type: 'node', frame });
  };

  const handleToggleCalculator = () => {
    setMenuOpen(false);
    setSelection(null);
    setCalculatorPick(null);
    setCalculatorOpen(open => !open);
  };

  const handleCloseCalculator = () => {
    setCalculatorOpen(false);
    setCalculatorPick(null);
  };

  return (
    <section
      ref={panelRef}
      className={`tf-tree-panel${isCompact ? ' is-compact' : ''}${calculatorOpen ? ' has-calculator' : ''}`}
      data-testid="tf-tree-panel"
    >
      <div className="tf-tree-canvas" data-testid="tf-tree-canvas">
        {nodes.length === 0 && (
          <div className="tf-tree-empty">
            {state.transformsByChild.size === 0
              ? 'Waiting for /tf and /tf_static...'
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
          onNodeClick={(_event, node) => handleNodeClick(node.id)}
          onEdgeClick={(_event, edge) => {
            const transform = edge.data as TfTransformRecord | undefined;
            if (transform) setSelection({ type: 'edge', childFrame: transform.childFrame });
          }}
          onPaneClick={() => setSelection(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={3}
            style={{
              background: 'var(--card-bg, #ffffff)',
              border: '1px solid var(--border-color, #e0e0e0)',
            }}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <TfTreeControls
        menuOpen={menuOpen}
        onMenuOpen={() => setMenuOpen(true)}
        onMenuClose={() => setMenuOpen(false)}
        isPaused={isPaused}
        onPause={pause}
        onResume={resume}
        onRefresh={refresh}
        onArrange={handleArrange}
        calculatorOpen={calculatorOpen}
        onToggleCalculator={handleToggleCalculator}
        onFocusTree={handleFocusTree}
        visibleTrees={visibleTrees}
        frameCount={visibleFrames.size}
        transformCount={visibleTransforms.length}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onSelectFrame={handleSelectFrame}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
        showStatic={showStatic}
        onShowStaticChange={setShowStatic}
        highlightStale={highlightStale}
        onHighlightStaleChange={setHighlightStale}
        cycles={diagnostics.cycles}
        multipleParents={diagnostics.multipleParents}
      />

      {calculatorOpen && calculatorPick === null && (
        <TfCalculator
          state={state}
          sourceFrame={calculatorSource}
          targetFrame={calculatorTarget}
          onSourceFrameChange={setCalculatorSource}
          onTargetFrameChange={setCalculatorTarget}
          onPickFrame={setCalculatorPick}
          onClose={handleCloseCalculator}
        />
      )}

      {calculatorPick && (
        <div className="tf-tree-pick-frame" role="status" data-testid="tf-tree-pick-frame">
          <span>Select the {calculatorPick} frame</span>
          <button type="button" onClick={() => setCalculatorPick(null)}>
            Cancel
          </button>
        </div>
      )}

      {selection && (
        <aside className="tf-tree-details" aria-label="TF selection details" data-testid="tf-tree-details">
          <div className="tf-tree-details-heading">
            <div>
              <span>Selection</span>
              <h2>{selection.type === 'node' ? selection.frame : selectedTransform?.childFrame}</h2>
            </div>
            <button
              type="button"
              onClick={() => setSelection(null)}
              title="Close details"
              aria-label="Close TF details"
            >
              <FaTimes aria-hidden="true" />
            </button>
          </div>
          {selection.type === 'node' && (
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
              <dt>Translation XYZ (m)</dt>
              <dd>
                {selectedTransform.translation
                  ? formatVector([
                      selectedTransform.translation.x,
                      selectedTransform.translation.y,
                      selectedTransform.translation.z,
                    ])
                  : 'Unavailable'}
              </dd>
              <dt>Quaternion XYZW</dt>
              <dd>
                {selectedTransform.rotation
                  ? formatVector([
                      selectedTransform.rotation.x,
                      selectedTransform.rotation.y,
                      selectedTransform.rotation.z,
                      selectedTransform.rotation.w,
                    ])
                  : 'Unavailable'}
              </dd>
              <dt>Euler RPY (rad)</dt>
              <dd>
                {selectedEuler
                  ? formatVector([selectedEuler.roll, selectedEuler.pitch, selectedEuler.yaw])
                  : 'Unavailable'}
              </dd>
              <dt>Euler RPY (deg)</dt>
              <dd>
                {selectedEuler
                  ? formatVector(
                      [selectedEuler.roll, selectedEuler.pitch, selectedEuler.yaw].map(
                        value => (value * 180) / Math.PI
                      ),
                      2
                    )
                  : 'Unavailable'}
              </dd>
            </dl>
          )}
        </aside>
      )}
    </section>
  );
};

const TfTreePanel: React.FC<TfTreePanelProps> = props => (
  <ReactFlowProvider>
    <TfTreePanelInner {...props} />
  </ReactFlowProvider>
);

export default TfTreePanel;
