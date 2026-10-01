import React, { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
} from 'reactflow';
import type { NodeProps } from 'reactflow';
import type { RuntimeNode } from './types';
import type { NativeTreeController } from './useNativeTreeController';
import type { SourceNode } from './projection';
import type { RuntimeState } from './types';
import { arrangeBehaviorTree } from '../layoutUtils';
import '../components/nodes/NodeStyles.css';
import '../components/execution/ExecutionDetails.css';
import './NativeTreeCanvas.css';

function NativeNode({ data, selected }: NodeProps<RuntimeNode>) {
  const status = data.status === 'idle' ? data.lastResult || 'idle' : data.status;
  const attributes = (data as SourceNode).attributes || data.ports || {};
  const bindings = Object.entries(attributes).filter(([, value]) => /^\{[^{}]+\}$/.test(value));
  return (
    <div
      className={`bt-node bt-native-node status-${status}${selected ? ' selected' : ''}`}
      data-testid={`native-node-${data.id}`}
    >
      <Handle type="target" position={Position.Top} className="bt-handle" />
      <div className="bt-node-header">
        <span className="bt-node-type">{data.type}</span>
      </div>
      <div className="bt-node-content">
        <div className="bt-node-label" title={data.label}>
          {data.label}
        </div>
        <div className="bt-node-detail">
          {data.status === 'idle' && data.lastResult ? `Last result: ${data.lastResult}` : data.status}
        </div>
        {bindings.length > 0 && (
          <div className="bt-data-flow">
            {bindings.map(([name, value]) => (
              <span key={name} title={`${name} → ${value}`}>
                <i />
                {name}: {value}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="bt-node-status">
        <div className={`bt-status-indicator status-${status}`} />
      </div>
      <Handle type="source" position={Position.Bottom} className="bt-handle" />
    </div>
  );
}
const nodeTypes = { native: NativeNode };

function NativeViewport({
  arrange,
  follow,
  nodes,
  viewKey,
}: {
  arrange: number;
  follow: boolean;
  nodes: SourceNode[];
  viewKey: string;
}) {
  const { fitView, getNodes, getEdges, setNodes } = useReactFlow();
  // Wait for THIS view, not the previous React Flow store's measured nodes.
  const initialized = useStore(
    state =>
      nodes.length > 0 &&
      state.nodeInternals.size === nodes.length &&
      nodes.every(node => {
        const measured = state.nodeInternals.get(node.id);
        return !!measured?.width && !!measured.height;
      })
  );
  const size = useStore(state => `${state.width}:${state.height}`);
  useEffect(() => {
    if (!initialized || size.split(':').some(dimension => Number(dimension) <= 0)) return;
    setNodes(arrangeBehaviorTree(getNodes(), getEdges()));
    // Layout first, then fit the painted, measured graph. Live status updates
    // never rerun this effect; user zoom/pan owns the viewport between views.
    let paintFrame = 0;
    const layoutFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => void fitView({ padding: 0.22 }));
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      cancelAnimationFrame(paintFrame);
    };
  }, [initialized, size, viewKey, arrange, fitView, getNodes, getEdges, setNodes]);
  const active = [...nodes].reverse().find(node => node.status === 'running')?.id;
  useEffect(() => {
    if (initialized && follow && active) void fitView({ nodes: [{ id: active }], maxZoom: 1.2, duration: 250 });
  }, [initialized, follow, active, fitView]);
  return null;
}

function NativeCanvasContent({
  controller,
  state,
  interactionMode,
  follow,
  arrange,
  onManualNavigation,
}: {
  controller: NativeTreeController;
  state: RuntimeState;
  interactionMode: 'pan' | 'select';
  follow: boolean;
  arrange: number;
  onManualNavigation: () => void;
}) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  useEffect(() => setInspectedId(null), [controller.viewKey, controller.sourceOpen]);
  useEffect(() => {
    if (!controller.sourceOpen && !inspectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        controller.setSourceOpen(false);
        setInspectedId(null);
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [controller.sourceOpen, controller.setSourceOpen, inspectedId]);
  const edges = useMemo(
    () =>
      controller.nodes
        .filter(node => node.parentId)
        .map(node => ({
          id: `${node.parentId}-${node.id}`,
          source: node.parentId!,
          target: node.id,
          animated: node.status === 'running',
        })),
    [controller.nodes]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<SourceNode>([]);
  useEffect(() => {
    setNodes(previous => {
      const existing = new Map(previous.map(node => [node.id, node]));
      const updated = controller.nodes.map(data => ({
        ...existing.get(data.id),
        id: data.id,
        type: 'native',
        position: existing.get(data.id)?.position || { x: 0, y: 0 },
        data,
      }));
      return previous.length ? updated : arrangeBehaviorTree(updated, edges);
    });
  }, [controller.nodes, controller.viewKey, edges, setNodes]);
  const selected = controller.nodes.find(node => node.id === inspectedId);
  const attributes = selected && ((selected as SourceNode).attributes || selected.ports || {});
  const nodeLogs = selected?.runtimeId ? state.logs.filter(log => log.id === selected.runtimeId) : [];
  return (
    <div
      className="bt-canvas"
      data-testid="bt-canvas"
      onPointerDownCapture={event => {
        if ((event.target as Element).closest('.react-flow__minimap')) onManualNavigation();
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        panOnDrag={interactionMode === 'pan'}
        selectionOnDrag={interactionMode === 'select'}
        onNodeClick={(_, node) => setInspectedId(node.id)}
        onPaneClick={() => setInspectedId(null)}
        onMoveStart={event => {
          if (event) onManualNavigation();
        }}
        onNodeDoubleClick={(_, node) => {
          const path = (node.data as SourceNode).subtreeView;
          if (path) controller.openSubtree(path);
        }}
        minZoom={0.05}
        maxZoom={2}
        deleteKeyCode={null}
        defaultEdgeOptions={{ style: { stroke: 'var(--primary-color)', strokeWidth: 2 } }}
      >
        <NativeViewport arrange={arrange} follow={follow} nodes={controller.nodes} viewKey={controller.viewKey} />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls
          showInteractive={false}
          onZoomIn={onManualNavigation}
          onZoomOut={onManualNavigation}
          onFitView={onManualNavigation}
        />
        <MiniMap zoomable pannable style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)' }} />
      </ReactFlow>
      <div className="bt-runtime-status" role="status">
        {controller.viewTreeId && (
          <button className="bt-selection-action" onClick={controller.parentView}>
            Parent tree
          </button>
        )}
        <span>
          {controller.descriptor?.version && `${controller.descriptor.version} · `}
          {!state.connected
            ? 'Host executor unavailable'
            : !controller.descriptor?.available
              ? controller.descriptor?.reason || 'Runtime unavailable'
              : controller.descriptor.enabled === false
                ? 'Engine disabled'
                : 'Available on ROS host'}
        </span>
        {controller.session && (
          <span data-testid="bt-runtime-state">
            {' '}
            · {controller.session.state}
            {controller.session.result ? `: ${controller.session.result}` : ''}
          </span>
        )}
        {!controller.compatible && (
          <span> · Select the engine matching this tree, or load a tree for the selected engine.</span>
        )}
        {controller.notice && <span> · {controller.notice}</span>}
        {controller.error && (
          <span className="bt-native-error" role="alert">
            {controller.error}
          </span>
        )}
        {controller.differentHostTree && (
          <button disabled={controller.busy} onClick={controller.showHost}>
            Show host tree
          </button>
        )}
      </div>
      {(controller.sourceOpen || selected) && (
        <aside
          className="bt-exec-card bt-native-inspector"
          aria-label={controller.sourceOpen ? 'XML source editor' : 'Node details'}
        >
          <div className="bt-native-inspector-header">
            <strong>{controller.sourceOpen ? 'XML source' : selected!.label}</strong>
            <button
              aria-label="Close inspector"
              onClick={() => {
                controller.setSourceOpen(false);
                setInspectedId(null);
              }}
            >
              ×
            </button>
          </div>
          <div className="bt-native-inspector-body">
            {controller.sourceOpen ? (
              <textarea
                aria-label="Tree XML"
                spellCheck={false}
                value={controller.document!.xml}
                disabled={controller.locked}
                onChange={event => controller.changeDocument({ xml: event.target.value, mainTreeId: undefined })}
              />
            ) : (
              <>
                <p>
                  {selected!.type} · {selected!.nativeStatus}
                  {selected!.lastResult ? ` · Last result: ${selected!.lastResult}` : ''}
                </p>
                {(selected as SourceNode).subtreeId && (
                  <button
                    className="bt-menu-action-btn"
                    onClick={() => controller.openSubtree((selected as SourceNode).subtreeView!)}
                  >
                    Open subtree
                  </button>
                )}
                <h4>Ports and attributes</h4>
                <dl>
                  {Object.entries(attributes!).map(([name, value]) => (
                    <React.Fragment key={name}>
                      <dt>{name}</dt>
                      <dd>{value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                {!Object.keys(attributes!).length && <p>No configured ports.</p>}
                {selected!.feedback && <p>{selected!.feedback}</p>}
                {nodeLogs.length > 0 && (
                  <details>
                    <summary>Execution details</summary>
                    {nodeLogs.map((log, index) => (
                      <div key={index}>
                        <strong>{log.type}</strong>
                        {(log.message || log.error) && <p>{log.message || log.error}</p>}
                        {(log.feedback !== undefined || log.result !== undefined) && (
                          <pre>{JSON.stringify(log.feedback ?? log.result, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </details>
                )}
                <button className="bt-menu-action-btn" onClick={() => controller.setSourceOpen(true)}>
                  Edit XML source
                </button>
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

export default function NativeTreeCanvas(props: React.ComponentProps<typeof NativeCanvasContent>) {
  // A new definition/view needs fresh DOM measurements, even if its source IDs
  // overlap the old view. Execution updates keep this store and viewport intact.
  return (
    <ReactFlowProvider key={props.controller.viewKey}>
      <NativeCanvasContent {...props} />
    </ReactFlowProvider>
  );
}
