import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { ORDERED_EDGE_STYLE } from '../orderUtils';
import SubtreeParentButton, { useSubtreeReturnAnchor } from '../components/SubtreeParentButton';
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
      title={(data as SourceNode).subtreeId ? 'Double-click to open this subtree instance' : undefined}
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
      <Handle
        type="source"
        position={Position.Bottom}
        className="bt-handle"
        isConnectableStart={(data as SourceNode).childrenPolicy !== 'none'}
      />
    </div>
  );
}
function NativeNodeEditor({ node, controller }: { node: SourceNode; controller: NativeTreeController }) {
  const [attributes, setAttributes] = useState(node.attributes);
  const [port, setPort] = useState('');
  const [value, setValue] = useState('');
  useEffect(() => setAttributes(node.attributes), [node.attributes]);
  const commit = (next: Record<string, string>) => controller.setAttributes(node.editId!, next);
  return (
    <>
      <p className="bt-menu-hint">
        Use {'{key}'} to bind a port to the blackboard. Child priority follows connection order; Earlier/Later changes
        it.
      </p>
      {Object.entries(attributes).map(([name, entry]) => (
        <label className="bt-native-field" key={name}>
          <span>{name}</span>
          <input
            aria-label={`Node attribute ${name}`}
            value={entry}
            onChange={event => setAttributes({ ...attributes, [name]: event.target.value })}
            onBlur={() => commit(attributes)}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          <button
            aria-label={`Remove attribute ${name}`}
            onClick={() => {
              const next = { ...attributes };
              delete next[name];
              setAttributes(next);
              commit(next);
            }}
          >
            ×
          </button>
        </label>
      ))}
      <form
        className="bt-native-port-form"
        onSubmit={event => {
          event.preventDefault();
          if (!port.trim()) return;
          const next = { ...attributes, [port.trim()]: value };
          setAttributes(next);
          commit(next);
          setPort('');
          setValue('');
        }}
      >
        <input
          aria-label="New attribute or port"
          placeholder="Port or attribute"
          value={port}
          onChange={event => setPort(event.target.value)}
        />
        <input
          aria-label="New port value"
          placeholder="Value or {key}"
          value={value}
          onChange={event => setValue(event.target.value)}
        />
        <button className="bt-menu-action-btn" type="submit">
          Add port
        </button>
      </form>
    </>
  );
}
const nodeTypes = { native: NativeNode };

function NativeViewport({
  arrange,
  follow,
  nodes,
  viewKey,
  onArrange,
}: {
  arrange: number;
  follow: boolean;
  nodes: SourceNode[];
  viewKey: string;
  onArrange: (positions: Array<{ id: string; x: number; y: number }>) => void;
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
  const fitted = useRef<string>();
  const arrangeCommit = useRef(onArrange);
  arrangeCommit.current = onArrange;
  const size = useStore(state => `${state.width}:${state.height}`);
  useEffect(() => {
    if (!initialized || size.split(':').some(dimension => Number(dimension) <= 0)) return;
    const request = `${size}:${arrange}`;
    if (fitted.current === request) return;
    const explicitArrange = fitted.current !== undefined && !fitted.current.endsWith(`:${arrange}`);
    fitted.current = request;
    const arranged =
      explicitArrange || !nodes.some(node => node.position) ? arrangeBehaviorTree(getNodes(), getEdges()) : null;
    if (arranged) setNodes(arranged);
    // Layout first, then fit the painted, measured graph. Live status updates
    // never rerun this effect; user zoom/pan owns the viewport between views.
    let paintFrame = 0;
    const layoutFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => {
        void fitView({ padding: 0.22 });
        if (explicitArrange && arranged)
          arrangeCommit.current(
            arranged.filter(node => node.data.editId).map(node => ({ id: node.data.editId, ...node.position }))
          );
      });
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
  const { screenToFlowPosition } = useReactFlow();
  const [edgeChild, setEdgeChild] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspectTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(inspectTimer.current), [controller.viewKey]);
  useEffect(() => {
    clearTimeout(inspectTimer.current);
    setInspectedId(null);
  }, [controller.viewKey, controller.sourceOpen]);
  useEffect(() => {
    if (!controller.sourceOpen && !inspectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimeout(inspectTimer.current);
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
          label: node.childOrder ? String(node.childOrder) : undefined,
          animated: node.status === 'running',
        })),
    [controller.nodes]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<SourceNode>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const parentAnchor = useSubtreeReturnAnchor(canvasRef, !!controller.viewTreeId, controller.viewKey, nodes);
  useEffect(() => {
    setNodes(previous => {
      const existing = new Map(previous.map(node => [node.id, node]));
      const updated = controller.nodes.map(data => ({
        ...existing.get(data.id),
        id: data.id,
        type: 'native',
        position: data.position || existing.get(data.id)?.position || { x: 0, y: 0 },
        data,
      }));
      if (!previous.length || updated.some(node => !existing.has(node.id) && !node.data.position)) {
        return arrangeBehaviorTree(updated, edges).map(node => ({
          ...node,
          position: node.data.position || node.position,
        }));
      }
      return updated;
    });
  }, [controller.nodes, controller.viewKey, edges, setNodes]);
  const selected = controller.nodes.find(node => node.id === inspectedId);
  const attributes = selected && ((selected as SourceNode).attributes || selected.ports || {});
  const nodeLogs = !controller.observed && selected?.runtimeId ? state.logs.filter(log => log.id === selected.runtimeId) : [];
  return (
    <div
      ref={canvasRef}
      className="bt-canvas"
      data-testid="bt-canvas"
      onDragOver={event => {
        if (controller.editable) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={event => {
        event.preventDefault();
        if (!controller.editable) return;
        try {
          const payload = JSON.parse(event.dataTransfer.getData('application/reactflow'));
          const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          if (payload.native && payload.savedTree) controller.addSaved(payload.savedTree, position);
          else if (payload.native && typeof payload.tag === 'string')
            controller.addNode(payload.tag, payload.attributes, position);
          else if (payload.item?.nativeDocument) controller.addSaved(payload.item, position);
          else throw new Error('Choose a native node or a subtree for this engine.');
        } catch (err) {
          controller.reportError((err as Error).message);
        }
      }}
      onPointerDownCapture={event => {
        if ((event.target as Element).closest('.react-flow__minimap')) onManualNavigation();
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        nodesDraggable={controller.editable}
        nodeDragThreshold={4}
        nodesConnectable={controller.editable}
        onConnect={connection => {
          const parent = controller.nodes.find(node => node.id === connection.source)?.editId;
          const child = controller.nodes.find(node => node.id === connection.target)?.editId;
          if (parent && child) controller.connect(parent, child);
        }}
        onNodeDragStop={(_, __, dragged) => {
          controller.move(
            dragged.filter(node => node.data.editId).map(node => ({ id: node.data.editId!, ...node.position }))
          );
        }}
        onEdgeClick={(_, edge) => {
          clearTimeout(inspectTimer.current);
          setInspectedId(null);
          setEdgeChild(controller.nodes.find(node => node.id === edge.target)?.editId || null);
        }}
        zoomOnDoubleClick={false}
        panOnDrag={interactionMode === 'pan'}
        selectionOnDrag={interactionMode === 'select'}
        onNodeClick={(event, node) => {
          clearTimeout(inspectTimer.current);
          setEdgeChild(null);
          // Let a subtree double-click finish before an inspector can cover it.
          if (node.data.subtreeView && event.detail)
            inspectTimer.current = setTimeout(() => setInspectedId(node.id), 400);
          else setInspectedId(node.id);
        }}
        onPaneClick={() => {
          clearTimeout(inspectTimer.current);
          setInspectedId(null);
          setEdgeChild(null);
        }}
        onMoveStart={event => {
          if (event) onManualNavigation();
        }}
        onNodeDoubleClick={(_, node) => {
          clearTimeout(inspectTimer.current);
          const path = (node.data as SourceNode).subtreeView;
          if (path) controller.openSubtree(path);
        }}
        minZoom={0.05}
        maxZoom={2}
        deleteKeyCode={null}
        defaultEdgeOptions={{
          style: { stroke: 'var(--primary-color)', strokeWidth: 2 },
          ...ORDERED_EDGE_STYLE,
        }}
      >
        <NativeViewport
          arrange={arrange}
          follow={follow}
          nodes={controller.nodes}
          viewKey={controller.viewKey}
          onArrange={controller.move}
        />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls
          showInteractive={false}
          onZoomIn={onManualNavigation}
          onZoomOut={onManualNavigation}
          onFitView={onManualNavigation}
        />
        <MiniMap zoomable pannable style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)' }} />
      </ReactFlow>
      {parentAnchor && <SubtreeParentButton anchor={parentAnchor} onNavigate={controller.parentView} />}
      {controller.error && (
        <div className="bt-native-alert" role="alert">
          {controller.error}
        </div>
      )}
      {edgeChild && controller.editable && (
        <div className="bt-native-edge-actions">
          <button
            className="bt-menu-action-btn"
            onClick={() => {
              controller.disconnect(edgeChild);
              setEdgeChild(null);
            }}
          >
            Disconnect nodes
          </button>
        </div>
      )}
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
              <>
                <p className="bt-menu-hint">
                  {controller.observed ? "Runtime instance XML from the robot, available for read-only inspection." : "Editing XML replaces the visual draft. Save first to keep disconnected nodes and their layout."}
                </p>
                <textarea
                  aria-label="Tree XML"
                  spellCheck={false}
                  value={controller.sourceXml || ''}
                  readOnly={controller.locked}
                  onChange={event => controller.changeDocument({ xml: event.target.value, mainTreeId: undefined })}
                />
              </>
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
                {controller.editable && selected!.editId ? (
                  <NativeNodeEditor key={selected!.editId} node={selected!} controller={controller} />
                ) : (
                  <dl>
                    {Object.entries(attributes!).map(([name, value]) => (
                      <React.Fragment key={name}>
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
                {!Object.keys(attributes!).length && <p>No configured ports.</p>}
                {controller.editable && selected!.editId && (
                  <div className="bt-native-edit-actions">
                    <button className="bt-menu-action-btn" onClick={() => controller.reorder(selected!.editId!, -1)}>
                      Earlier
                    </button>
                    <button className="bt-menu-action-btn" onClick={() => controller.reorder(selected!.editId!, 1)}>
                      Later
                    </button>
                    <button
                      className="bt-menu-action-btn"
                      disabled={!selected!.parentId}
                      onClick={() => controller.disconnect(selected!.editId!)}
                    >
                      Detach node
                    </button>
                    <button
                      className="bt-menu-action-btn"
                      onClick={() => {
                        controller.remove(selected!.editId!);
                        setInspectedId(null);
                      }}
                    >
                      Delete branch
                    </button>
                  </div>
                )}
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
                {controller.sourceXml && <button className="bt-menu-action-btn" onClick={() => controller.setSourceOpen(true)}>
                  {controller.observed ? "View XML source" : "Edit XML source"}
                </button>}
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
