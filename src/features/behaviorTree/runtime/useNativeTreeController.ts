import { useEffect, useMemo, useState } from 'react';
import type { BehaviorTree } from '../types';
import type { BehaviorTreeExecutionControls, BehaviorTreeExecutionSnapshot } from '../components/BehaviorTreePanel';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';
import { inspectXml, nativeTreeFromXml, validateDocument } from './xml';
import type { RuntimeNode, TreeRuntimeId } from './types';

export interface SourceNode extends RuntimeNode {
  attributes: Record<string, string>;
  subtreeId?: string;
}

export function projectXml(xml: string, runtime: TreeRuntimeId | null, treeId?: string) {
  const inspected = inspectXml(xml, runtime, treeId);
  const nodes: SourceNode[] = [];
  const walk = (element: Element, parentId: string | null) => {
    const id = `source-${nodes.length}`;
    nodes.push({
      id,
      parentId,
      label: element.getAttribute('name') || element.getAttribute('ID') || element.tagName,
      type: element.tagName,
      status: 'idle',
      nativeStatus: 'IDLE',
      feedback: '',
      attributes: Object.fromEntries(
        Array.from(element.attributes).map(attribute => [attribute.name, attribute.value])
      ),
      ...(element.tagName === 'SubTree' ? { subtreeId: element.getAttribute('ID')! } : {}),
    });
    Array.from(element.children).forEach(child => walk(child, id));
  };
  inspected.trees
    .filter(tree => !inspected.mainTreeId || tree.getAttribute('ID') === inspected.mainTreeId)
    .forEach(tree => walk(tree.children[0], null));
  return { ...inspected, nodes };
}

export function useNativeTreeController(
  tree: BehaviorTree | null,
  runtime: ReturnType<typeof useRemoteTreeRuntime>,
  engine: 'json' | TreeRuntimeId | null,
  onChange: (tree: BehaviorTree) => void,
  onExecutionChange?: (snapshot: BehaviorTreeExecutionSnapshot) => void,
  onExecutionControlsChange?: (controls: BehaviorTreeExecutionControls | null) => void
) {
  const { client, state } = runtime;
  const document = tree?.nativeDocument;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewTreeId, setViewTreeId] = useState<string | undefined>();
  const [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => {
    setViewTreeId(undefined);
    setError(null);
    setNotice(null);
    setSourceOpen(false);
  }, [tree?.id]);
  const preview = useMemo(() => {
    if (!document) return { nodes: [] as SourceNode[], trees: [] as Element[], mainTreeId: '', error: null };
    try {
      const definition = projectXml(document.xml, document.runtime, document.mainTreeId);
      const projection = viewTreeId ? projectXml(document.xml, document.runtime, viewTreeId) : definition;
      return {
        ...projection,
        mainTreeId: definition.mainTreeId,
        error: definition.mainTreeId ? null : 'Choose the main tree in the tree menu.',
      };
    } catch (err) {
      return { nodes: [] as SourceNode[], trees: [] as Element[], mainTreeId: '', error: (err as Error).message };
    }
  }, [document, viewTreeId]);
  const matching =
    document &&
    state.session?.xml === document.xml &&
    state.session.runtime === document.runtime &&
    (state.session.mainTreeId || '') === (document.mainTreeId || preview.mainTreeId || '');
  const session = matching ? state.session : null;
  const running = state.session?.state === 'running';
  const descriptor = state.runtimes.find(item => item.id === engine);
  const compatible = !!document && engine === document.runtime;
  const ready = compatible && state.connected && descriptor?.available && descriptor.enabled !== false;
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
  const changeDocument = (patch: Partial<NonNullable<typeof document>>) => {
    if (!tree || !document || busy || running) return;
    setError(null);
    setNotice(null);
    onChange({ ...tree, nativeDocument: { ...document, ...patch }, updatedAt: Date.now() });
  };
  const run = () =>
    client &&
    document &&
    void perform(async () => {
      if (!ready) throw new Error('Select and enable the engine matching this XML tree.');
      setViewTreeId(undefined);
      if (!session) await client.load(validateDocument(document));
      else if (session.state !== 'loaded') await client.reset();
      await client.start();
    });
  const stop = () => client && void perform(() => client.stop());
  useEffect(() => {
    if (!tree) return;
    const active = session?.nodes.find(node => node.status === 'running');
    onExecutionChange?.({
      isExecuting: !!running,
      isPersistent: true,
      treeName: tree.name,
      activeNodeId: active?.id,
      activeNodeLabel: active?.label,
      startedAt: session?.startedAt,
      status: running
        ? undefined
        : session?.state === 'error'
          ? 'error'
          : session?.state === 'completed'
            ? 'completed'
            : 'stopped',
    });
  }, [tree, running, session, onExecutionChange]);
  useEffect(() => {
    if (!tree) return;
    onExecutionControlsChange?.({
      stop: () => {
        if (client) void client.stop().catch(err => setError(err.message));
      },
    });
    return () => onExecutionControlsChange?.(null);
  }, [!!tree, client, onExecutionControlsChange]);
  return {
    tree,
    document,
    preview,
    session,
    running,
    busy,
    locked: busy || !!running,
    descriptor,
    compatible,
    ready,
    error: error || preview.error || state.error || session?.error,
    notice,
    sourceOpen,
    setSourceOpen,
    viewTreeId,
    selectTree: (id?: string) => setViewTreeId(id === preview.mainTreeId ? undefined : id),
    changeDocument,
    assignRuntime: (id: TreeRuntimeId) => {
      if (!document) return;
      try {
        inspectXml(document.xml, id, document.mainTreeId);
        changeDocument({ runtime: id });
      } catch (err) {
        setError((err as Error).message);
      }
    },
    run,
    stop,
    nodes: viewTreeId ? preview.nodes : session?.nodes || preview.nodes,
    cancel: () => client && void perform(() => client.cancel()),
    reset: () => client && void perform(() => client.reset(), 'Tree reset.'),
    validate: () =>
      client &&
      document &&
      void perform(() => client.validate(validateDocument(document)), 'Native validation passed.'),
    load: () =>
      client && document && void perform(() => client.load(validateDocument(document)), 'Tree loaded on ROS host.'),
    showHost: () =>
      state.session &&
      onChange(nativeTreeFromXml(state.session.xml, state.session.runtime, 'Host tree', state.session.mainTreeId)),
    differentHostTree: !!state.session && !matching,
  };
}
export type NativeTreeController = ReturnType<typeof useNativeTreeController>;
