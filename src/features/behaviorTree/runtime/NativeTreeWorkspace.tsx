import React, { useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, Handle, NodeProps, Position, useNodesInitialized, useReactFlow, useStore } from 'reactflow';
import { BehaviorTree } from '../types';
import { exportBehaviorTree, saveBehaviorTree } from '../storage/treeStorage';
import type { BehaviorTreeExecutionControls, BehaviorTreeExecutionSnapshot } from '../components/BehaviorTreePanel';
import { RuntimeNode, TreeRuntimeId } from './types';
import { inspectXml, nativeTreeFromXml, newXmlTemplate, treeFormats, validateDocument } from './xml';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';
import BehaviorTreeDocumentMenu from '../components/BehaviorTreeDocumentMenu';
import RuntimeEngineSettings from './RuntimeEngineSettings';
import './NativeTreeWorkspace.css';

function NativeNode({ data }: NodeProps<RuntimeNode>) {
  return (
    <div className={`bt-native-node status-${data.status === 'idle' ? data.lastResult || data.status : data.status}`} data-testid={`native-node-${data.id}`}>
      <Handle type="target" position={Position.Top} />
      <small>{data.type}</small>
      <strong>{data.label}</strong>
      <span>
        {data.status}
        {data.nativeStatus.toLowerCase() !== data.status ? ` (${data.nativeStatus})` : ''}
      </span>
      {data.status === 'idle' && data.lastResult && <small>Last result: {data.lastResult}</small>}
      {data.feedback && <p>{data.feedback}</p>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { native: NativeNode };

function NativeViewport() {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const geometry = useStore(state => `${state.width}:${state.height}:` +
    Array.from(state.nodeInternals.values()).map(node => `${node.id}:${node.width}:${node.height}`).join('|'));
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.2 }));
    return () => cancelAnimationFrame(frame);
  }, [initialized, geometry, fitView]);
  return null;
}

function sourceNodes(xml: string, runtime: TreeRuntimeId | null, mainTreeId?: string): RuntimeNode[] {
  const { trees, mainTreeId: selected } = inspectXml(xml, runtime, mainTreeId);
  const nodes: RuntimeNode[] = [];
  const walk = (el: Element, parentId: string | null) => {
    const id = `source-${nodes.length}`;
    nodes.push({
      id,
      parentId,
      label: el.getAttribute('name') || el.getAttribute('ID') || el.tagName,
      type: el.tagName,
      status: 'idle',
      nativeStatus: 'idle',
      feedback: '',
    });
    Array.from(el.children).forEach(child => walk(child, id));
  };
  trees.filter(tree => !selected || tree.getAttribute('ID') === selected).forEach(tree => walk(tree.children[0], null));
  return nodes;
}

interface Props {
  tree: BehaviorTree;
  runtime: ReturnType<typeof useRemoteTreeRuntime>;
  isConnected: boolean;
  onChange: (tree: BehaviorTree) => void;
  onNewGraph: () => void;
  onExecutionChange?: (snapshot: BehaviorTreeExecutionSnapshot) => void;
  onExecutionControlsChange?: (controls: BehaviorTreeExecutionControls | null) => void;
}

/** Backend differences are owned by format adapters and the ROS runtime, not UI conditionals. */
export default function NativeTreeWorkspace({
  tree,
  runtime,
  isConnected,
  onChange,
  onNewGraph,
  onExecutionChange,
  onExecutionControlsChange,
}: Props) {
  const { client, state } = runtime;
  const document = tree.nativeDocument!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'source' | 'tree'>('tree');
  const running = state.session?.state === 'running';
  const preview = useMemo(() => {
    try {
      return {
        nodes: sourceNodes(document.xml, document.runtime, document.mainTreeId),
        mainTreeId: inspectXml(document.xml, document.runtime, document.mainTreeId).mainTreeId,
        error: inspectXml(document.xml, document.runtime, document.mainTreeId).mainTreeId
          ? null
          : 'Choose the main tree in the tree menu.',
      };
    } catch (err) {
      return { nodes: [], error: (err as Error).message };
    }
  }, [document.xml, document.runtime, document.mainTreeId]);
  const matching =
    state.session?.xml === document.xml &&
    state.session.runtime === document.runtime &&
    (state.session.mainTreeId || '') === (document.mainTreeId || preview.mainTreeId || '');
  const session = matching ? state.session : null;
  const descriptor = state.runtimes.find(r => r.id === document.runtime);
  const hostReady = isConnected && state.connected && descriptor?.available && descriptor.enabled !== false;
  const lock = busy || !!running;
  const format = treeFormats.find(f => f.id === document.runtime);
  const shownNodes = session?.nodes || preview.nodes;
  const graph = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const counts = new Map<number, number>();
    const depth = (node: RuntimeNode, seen = new Set<string>()): number => {
      if (!node.parentId || seen.has(node.id)) return 0;
      seen.add(node.id);
      const parent = shownNodes.find(n => n.id === node.parentId);
      return parent ? depth(parent, seen) + 1 : 0;
    };
    shownNodes.forEach(node => {
      const level = depth(node);
      const column = counts.get(level) || 0;
      counts.set(level, column + 1);
      positions.set(node.id, { x: column * 230, y: level * 155 });
    });
    return {
      nodes: shownNodes.map(node => ({ id: node.id, type: 'native', position: positions.get(node.id)!, data: node })),
      edges: shownNodes
        .filter(n => n.parentId)
        .map(n => ({
          id: `${n.parentId}-${n.id}`,
          source: n.parentId!,
          target: n.id,
          animated: n.status === 'running',
        })),
    };
  }, [shownNodes]);

  const perform = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (message) setNotice(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changeDocument = (patch: Partial<typeof document>) => {
    setError(null);
    setNotice(null);
    onChange({ ...tree, nativeDocument: { ...document, ...patch }, updatedAt: Date.now() });
  };
  useEffect(() => {
    const active = session?.nodes.find(n => n.status === 'running');
    onExecutionChange?.({
      isExecuting: !!running,
      isPersistent: true,
      treeName: tree.name,
      activeNodeId: active?.id,
      activeNodeLabel: active?.label,
      status: running
        ? undefined
        : session?.state === 'error'
          ? 'error'
          : session?.state === 'completed'
            ? 'completed'
            : 'stopped',
      startedAt: session?.startedAt,
    });
  }, [onExecutionChange, running, session, tree.name]);
  useEffect(() => {
    onExecutionControlsChange?.({
      stop: () => {
        if (client) void perform(() => client.stop());
      },
    });
    return () => onExecutionControlsChange?.(null);
  }, [client, onExecutionControlsChange]);

  return (
    <div className="behavior-tree-panel bt-native-workspace" data-testid="behavior-tree-panel">
      <div className="bt-native-header" />
      <BehaviorTreeDocumentMenu
        allowDuringExecution
        currentTree={tree}
        isEditingLocked={lock}
        nodeCount={preview.nodes.length}
        onLoad={onChange}
        onNew={onNewGraph}
        onNewXml={() => onChange(nativeTreeFromXml(format?.template || newXmlTemplate, format?.id))}
        onRename={name => onChange({ ...tree, name, updatedAt: Date.now() })}
        onSave={() => {
          const ok = saveBehaviorTree(tree);
          setNotice(ok ? 'Tree saved.' : null);
          setError(ok ? null : 'Could not save tree.');
        }}
        onExport={() => exportBehaviorTree(tree)}
      >
        <div className="bt-menu-section">
          <label className="bt-menu-label">Tree format</label>
          <select
            aria-label="XML runtime"
            value={document.runtime || ''}
            disabled={lock}
            onChange={e => {
              const runtime = e.target.value as TreeRuntimeId;
              changeDocument({
                runtime,
                ...(document.xml === newXmlTemplate
                  ? { xml: treeFormats.find(f => f.id === runtime)!.template, mainTreeId: 'Main' }
                  : {}),
              });
            }}
          >
            <option value="" disabled>
              Choose XML runtime
            </option>
            {treeFormats.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
                {state.runtimes.find(r => r.id === f.id)?.available === false ? ' (unavailable)' : ''}
              </option>
            ))}
          </select>

          <div className="bt-menu-actions">
            <button
              className="bt-menu-action-btn"
              disabled={lock || !hostReady || !!preview.error}
              onClick={() =>
                client && void perform(() => client.validate(validateDocument(document)), 'Native validation passed.')
              }
            >
              Validate
            </button>
            <button
              className="bt-menu-action-btn"
              disabled={lock || !hostReady || !!preview.error}
              onClick={() =>
                client && void perform(() => client.load(validateDocument(document)), 'Tree loaded on ROS host.')
              }
            >
              Load on host
            </button>
          </div>
        </div>
        <div className="bt-menu-section">
          <label className="bt-menu-label">Main tree</label>
          <select
            aria-label="Main XML tree"
            value={document.mainTreeId || preview.mainTreeId || ''}
            disabled={lock}
            onChange={event => changeDocument({ mainTreeId: event.target.value })}
          >
            <option value="" disabled>
              Choose main tree
            </option>
            {(() => {
              try {
                return inspectXml(document.xml, document.runtime).trees.map(tree => {
                  const id = tree.getAttribute('ID')!;
                  return (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  );
                });
              } catch {
                return [];
              }
            })()}
          </select>
        </div>
        <RuntimeEngineSettings runtime={runtime} />
      </BehaviorTreeDocumentMenu>
      <div className="bt-native-status" role="status">
        <strong>{format?.label || 'Choose a runtime'}</strong>
        <span>
          {descriptor?.version ? ` ${descriptor.version}` : ''} ·{' '}
          {state.connected
            ? descriptor?.available
              ? descriptor.enabled === false
                ? 'Disabled on ROS host · enable in tree menu'
                : 'Available on ROS host'
              : descriptor?.reason || 'Runtime unavailable'
            : isConnected
              ? 'Waiting for host runtime'
              : 'ROS disconnected'}
        </span>
        {session && (
          <span data-testid="bt-runtime-state">
            {' '}
            · {session.state}
            {session.result ? `: ${session.result}` : ''}
          </span>
        )}
      </div>
      {(error || preview.error || state.error || session?.error) && (
        <div className="bt-native-error" role="alert">
          {error || preview.error || state.error || session?.error}
        </div>
      )}
      {!document.runtime && (
        <p className="bt-native-notice">
          This XML uses syntax shared by both frameworks. Choose its runtime before loading.
        </p>
      )}
      {notice && (
        <p className="bt-native-notice" role="status">
          {notice}
        </p>
      )}
      {state.session && !matching && (
        <div className="bt-native-notice">
          The host has a different tree {state.session.state}.
          <button
            disabled={busy}
            onClick={() =>
              onChange(
                nativeTreeFromXml(state.session!.xml, state.session!.runtime, 'Host tree', state.session!.mainTreeId)
              )
            }
          >
            Show host tree
          </button>
        </div>
      )}
      <div className="bt-float-actions bt-native-execution-controls">
        <button
          className="bt-float-run-btn"
          disabled={busy || !hostReady || running || !!preview.error}
          onClick={() =>
            client &&
            void perform(async () => {
              if (!session) await client.load(validateDocument(document));
              else if (session.state !== 'loaded') await client.reset();
              await client.start();
            })
          }
        >
          Run
        </button>
        <button
          className="bt-float-stop-btn"
          disabled={busy || !state.connected || !session || !running}
          onClick={() => client && void perform(() => client.stop())}
        >
          Stop
        </button>
        <button
          className="bt-float-stop-btn"
          disabled={busy || !state.connected || !session || !running}
          onClick={() => client && void perform(() => client.cancel())}
        >
          Cancel
        </button>
        <button
          className="bt-float-icon-btn"
          disabled={busy || !state.connected || !session || descriptor?.enabled === false}
          onClick={() => client && void perform(() => client.reset(), 'Tree reset.')}
        >
          Reset
        </button>
      </div>
      <div className="bt-native-controls">
        <span className="bt-native-view-switch">
          <button aria-pressed={view === 'source'} onClick={() => setView('source')}>
            XML source
          </button>
          <button aria-pressed={view === 'tree'} onClick={() => setView('tree')}>
            Tree states
          </button>
        </span>
      </div>
      <div className="bt-native-content">
        {view === 'source' ? (
          <textarea
            aria-label="Tree XML"
            spellCheck={false}
            value={document.xml}
            disabled={lock}
            onChange={e => changeDocument({ xml: e.target.value, mainTreeId: undefined })}
          />
        ) : (
          <ReactFlow
            key={session ? `${session.id}-${session.nodes[0]?.id}` : tree.id}
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            minZoom={0.1}
          >
            <NativeViewport />
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
      <details className="bt-native-logs" open={state.logs.length > 0}>
        <summary>Feedback and results ({state.logs.length})</summary>
        <div role="log" aria-label="Tree feedback">
          {state.logs.map((log, index) => (
            <div className="bt-runtime-log-entry" key={index}>
              <strong>
                {session?.nodes.find(node => node.id === log.id)?.label || 'Tree'} · {log.type}
              </strong>
              {(log.message || log.error) && <p>{log.message || log.error}</p>}
              {(log.feedback !== undefined || log.result !== undefined) && (
                <pre>{JSON.stringify(log.feedback ?? log.result, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
