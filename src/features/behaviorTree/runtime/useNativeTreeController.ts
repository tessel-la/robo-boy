import { useEffect, useMemo, useState } from 'react';
import type { BehaviorTree } from '../types';
import type { BehaviorTreeExecutionControls, BehaviorTreeExecutionSnapshot } from '../components/BehaviorTreePanel';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';
import { inspectXml, nativeTreeFromXml, validateDocument } from './xml';
import type { TreeRuntimeId } from './types';

import { projectXml, bindRuntimeProjection, liveSourceNode } from './projection';

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
  const [viewPath, setViewPath] = useState<string | undefined>();
  const [definitionId, setDefinitionId] = useState<string | undefined>();
  const [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => {
    setViewPath(undefined);
    setDefinitionId(undefined);
    setError(null);
    setNotice(null);
    setSourceOpen(false);
  }, [tree?.id]);
  const projection = useMemo(() => {
    if (!document) return { value: null, error: null };
    try {
      const value = projectXml(document.xml, document.runtime, document.mainTreeId);
      return { value, error: value.mainTreeId ? null : 'Choose the main tree in the tree menu.' };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  }, [document]);
  const view = projection.value?.views.get(viewPath || 'main');
  const viewTreeId = viewPath ? view?.treeId : definitionId;
  const preview = useMemo(() => {
    const value = projection.value;
    const nodes =
      definitionId && document && value?.trees.some(tree => tree.getAttribute('ID') === definitionId)
        ? projectXml(document.xml, document.runtime, definitionId).nodes
        : view?.nodes || value?.nodes || [];
    return { nodes, trees: value?.trees || [], mainTreeId: value?.mainTreeId || '', error: projection.error };
  }, [projection, view, definitionId, document]);
  const matching =
    document &&
    state.session?.xml === document.xml &&
    state.session.runtime === document.runtime &&
    (state.session.mainTreeId || '') === (document.mainTreeId || preview.mainTreeId || '');
  const session = matching ? state.session : null;
  const live = useMemo(
    () =>
      projection.value
        ? bindRuntimeProjection(projection.value, session?.nodes || [])
        : { bindings: new Map(), error: null },
    [projection, session?.nodes]
  );
  const nodes = useMemo(
    () => preview.nodes.map(node => liveSourceNode(node, definitionId ? undefined : live.bindings.get(node.id))),
    [preview.nodes, live, definitionId]
  );
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
    error: error || preview.error || state.error || session?.error || live.error,
    notice,
    sourceOpen,
    setSourceOpen,
    viewTreeId,
    selectTree: (id?: string) => {
      const instance =
        id && id !== preview.mainTreeId
          ? Array.from(projection.value?.views || []).find(([, item]) => item.treeId === id)
          : undefined;
      setViewPath(instance?.[0]);
      setDefinitionId(id && id !== preview.mainTreeId && !instance ? id : undefined);
    },
    openSubtree: (path: string) => {
      setViewPath(path);
      setDefinitionId(undefined);
    },
    parentView: () => {
      setViewPath(view?.parent === 'main' ? undefined : view?.parent);
      setDefinitionId(undefined);
    },
    viewKey: `${tree?.id}:${document?.xml}:${viewPath || definitionId || 'main'}`,

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
    nodes,
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
