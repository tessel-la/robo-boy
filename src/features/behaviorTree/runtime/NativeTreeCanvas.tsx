import React, { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from 'reactflow';
import type { NodeProps } from 'reactflow';
import type { RuntimeNode } from './types';
import type { NativeTreeController, SourceNode } from './useNativeTreeController';
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
        {data.status !== 'idle' && <div className="bt-node-detail">{data.status}</div>}
        {data.lastResult && data.status === 'idle' && (
          <div className="bt-node-detail">Last result: {data.lastResult}</div>
        )}
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

function NativeViewport({ arrange, follow, nodes }: { arrange: number; follow: boolean; nodes: RuntimeNode[] }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const geometry = useStore(
    state =>
      `${state.width}:${state.height}:` +
      Array.from(state.nodeInternals.values())
        .map(node => `${node.id}:${node.width}:${node.height}`)
        .join('|')
  );
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.22 }));
    return () => cancelAnimationFrame(frame);
  }, [initialized, geometry, arrange, fitView]);
  const active = nodes.find(node => node.status === 'running')?.id;
  useEffect(() => {
    if (initialized && follow && active) void fitView({ nodes: [{ id: active }], maxZoom: 1.2, duration: 250 });
  }, [initialized, follow, active, fitView]);
  return null;
}

export default function NativeTreeCanvas({
  controller,
  state,
  interactionMode,
  follow,
  arrange,
}: {
  controller: NativeTreeController;
  state: RuntimeState;
  interactionMode: 'pan' | 'select';
  follow: boolean;
  arrange: number;
}) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  useEffect(() => setInspectedId(null), [controller.tree?.id, controller.viewTreeId, controller.sourceOpen]);
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
  const graph = useMemo(() => {
    const edges = controller.nodes
      .filter(node => node.parentId)
      .map(node => ({
        id: `${node.parentId}-${node.id}`,
        source: node.parentId!,
        target: node.id,
        animated: node.status === 'running',
      }));
    const nodes = controller.nodes.map(node => ({ id: node.id, type: 'native', position: { x: 0, y: 0 }, data: node }));
    return { nodes: arrangeBehaviorTree(nodes, edges), edges };
  }, [controller.nodes]);
  const selected = controller.nodes.find(node => node.id === inspectedId);
  const attributes = selected && ((selected as SourceNode).attributes || selected.ports || {});
  const nodeLogs = state.logs.filter(log => log.id === selected?.id);
  return (
    <div className="bt-canvas" data-testid="bt-canvas">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnDrag={interactionMode === 'pan'}
        selectionOnDrag={interactionMode === 'select'}
        onNodeClick={(_, node) => setInspectedId(node.id)}
        onPaneClick={() => setInspectedId(null)}
        onNodeDoubleClick={(_, node) => {
          const id = (node.data as SourceNode).subtreeId;
          if (id) controller.selectTree(id);
        }}
        fitView
        minZoom={0.05}
        maxZoom={2}
        deleteKeyCode={null}
        defaultEdgeOptions={{ style: { stroke: 'var(--primary-color)', strokeWidth: 2 } }}
      >
        <NativeViewport arrange={arrange} follow={follow} nodes={controller.nodes} />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap zoomable pannable style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)' }} />
      </ReactFlow>
      <div className="bt-runtime-status" role="status">
        {controller.viewTreeId && (
          <button className="bt-selection-action" onClick={() => controller.selectTree(undefined)}>
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
                    onClick={() => controller.selectTree((selected as SourceNode).subtreeId)}
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
