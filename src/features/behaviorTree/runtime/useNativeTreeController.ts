import { useEffect, useMemo, useState } from 'react';
import type { BehaviorTree } from '../types';
import type { BehaviorTreeExecutionControls, BehaviorTreeExecutionSnapshot } from '../components/BehaviorTreePanel';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';
import { inspectXml, nativeTreeFromXml, validateDocument } from './xml';
import type { NativeEditorState, NativeTreeDocument, TreeRuntimeId } from './types';
import {
  addEditorNode,
  childrenOf,
  connectEditorNodes,
  editAttributes,
  editorAddresses,
  editorState,
  editorView,
  importSubtreeLibrary,
  nodeTemplate,
  parseNode,
  removeEditorBranch,
  reorderEditorNode,
  serializeEditor,
  executableXml,
} from './authoring';

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
  const storedDocument = tree?.nativeDocument;
  const model = useMemo(() => {
    if (!storedDocument) return { editor: null, error: null };
    try {
      return { editor: editorState(storedDocument), error: null };
    } catch (err) {
      return { editor: null, error: (err as Error).message };
    }
  }, [storedDocument?.xml, storedDocument?.editor]);
  const compiled = useMemo(() => {
    if (!storedDocument) return { document: undefined, error: null };
    try {
      return { document: { ...storedDocument, xml: executableXml(storedDocument), editor: undefined }, error: null };
    } catch (err) {
      return {
        document: {
          ...storedDocument,
          xml: model.editor ? serializeEditor(storedDocument, storedDocument.editor) : storedDocument.xml,
          editor: undefined,
        },
        error: (err as Error).message,
      };
    }
  }, [storedDocument, model]);
  const document = compiled.document;
  const [history, setHistory] = useState<NativeTreeDocument[]>([]);
  const [future, setFuture] = useState<NativeTreeDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewPath, setViewPath] = useState<string | undefined>();
  const [definitionId, setDefinitionId] = useState<string | undefined>();
  const [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => {
    setViewPath(undefined);
    setDefinitionId(undefined);
    setHistory([]);
    setFuture([]);
    setError(null);
    setNotice(null);
    setSourceOpen(false);
  }, [tree?.id]);
  const projection = useMemo(() => {
    if (!document) return { value: null, error: null };
    try {
      const value = projectXml(
        document.xml,
        document.runtime,
        document.mainTreeId,
        model.editor ? editorAddresses(model.editor) : undefined
      );
      return { value, error: value.mainTreeId ? null : 'Choose the main tree in the tree menu.' };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  }, [document, model]);
  const view = projection.value?.views.get(viewPath || 'main');
  const base = useMemo(() => {
    if (!storedDocument || !model.editor) return null;
    return inspectXml(storedDocument.xml, storedDocument.runtime, storedDocument.mainTreeId);
  }, [storedDocument, model]);
  const displayedTreeId = definitionId || view?.treeId || base?.mainTreeId || '';
  const prefix = viewPath || (definitionId ? `definition:${definitionId}` : 'main');
  const preview = useMemo(
    () => ({
      nodes:
        model.editor && storedDocument
          ? editorView(model.editor, displayedTreeId, prefix).map(node => ({
              ...node,
              childrenPolicy: nodeTemplate(storedDocument, node.type).children,
            }))
          : [],
      trees: base?.trees || [],
      mainTreeId: base?.mainTreeId || '',
      error: model.error || compiled.error || projection.error,
    }),
    [model, storedDocument, displayedTreeId, prefix, base, compiled.error, projection.error]
  );
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
    () =>
      preview.nodes.map(node =>
        liveSourceNode(node, prefix.startsWith('definition:') ? undefined : live.bindings.get(node.id))
      ),
    [preview.nodes, live, prefix]
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
  const publish = (next: NativeTreeDocument, remember = true) => {
    if (!tree || !storedDocument || busy || running) return;
    setError(null);
    setNotice(null);
    if (remember) {
      setHistory(items => [...items.slice(-49), storedDocument]);
      setFuture([]);
    }
    onChange({ ...tree, nativeDocument: next, updatedAt: Date.now() });
  };
  const changeDocument = (patch: Partial<NativeTreeDocument>) => {
    if (!storedDocument) return;
    publish({ ...storedDocument, ...patch, ...(patch.xml !== undefined ? { editor: undefined } : {}) });
  };
  const edit = (action: (editor: NativeEditorState) => NativeEditorState) => {
    if (!storedDocument || !model.editor || busy || running) return;
    try {
      const editor = action(model.editor);
      if (editor === model.editor || JSON.stringify(editor) === JSON.stringify(model.editor)) return;
      editorState({ ...storedDocument, editor });
      publish({ ...storedDocument, editor });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const addNode = (
    tag: string,
    attributes: Record<string, string> = {},
    position?: { x: number; y: number },
    parentId?: string
  ) => {
    if (!storedDocument) return;
    edit(editor => {
      const roots = childrenOf(editor, displayedTreeId, null);
      const defaultParent =
        !position &&
        roots.length === 1 &&
        nodeTemplate(storedDocument, parseNode(roots[0].template).tagName).children === 'many'
          ? roots[0].id
          : null;
      return addEditorNode(
        storedDocument,
        editor,
        displayedTreeId,
        tag,
        attributes,
        parentId || defaultParent,
        position
      );
    });
  };
  const importLibrary = (source: BehaviorTree, libraryPrefix = '') => {
    if (!storedDocument || !model.editor || busy || running) throw new Error('Stop execution before editing the tree.');
    if (!source.nativeDocument)
      throw new Error('Select an XML library for this engine. JSON trees use the Robo Boy editor.');
    const next = importSubtreeLibrary(storedDocument, model.editor, source.nativeDocument, libraryPrefix.trim());
    publish(next);
  };
  const run = () =>
    client &&
    document &&
    void perform(async () => {
      if (preview.error) throw new Error(preview.error);
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
    reportError: (message: string) => setError(message),
    sourceOpen,
    setSourceOpen,
    viewTreeId: viewPath || definitionId ? displayedTreeId : undefined,
    selectTree: (id?: string) => {
      const instance =
        id && id !== preview.mainTreeId
          ? Array.from(projection.value?.views || []).find(([, item]) => item.treeId === id)
          : undefined;
      setViewPath(instance?.[0]);
      setDefinitionId(id && id !== preview.mainTreeId ? id : undefined);
    },
    openSubtree: (path: string) => {
      const referenced = model.editor?.nodes.find(node => path.endsWith(`/${node.id}`));
      const id = referenced ? parseNode(referenced.template).getAttribute('ID') : null;
      if (!id || !base?.trees.some(tree => tree.getAttribute('ID') === id)) {
        setError('Select an existing subtree definition before opening it.');
        return;
      }
      setViewPath(path);
      setDefinitionId(id);
    },
    parentView: () => {
      const parent =
        view?.parent || (viewPath?.includes('/') ? viewPath.slice(0, viewPath.lastIndexOf('/')) : undefined);
      setViewPath(parent === 'main' ? undefined : parent);
      const reference = parent?.includes('/')
        ? model.editor?.nodes.find(node => parent.endsWith(`/${node.id}`))
        : undefined;
      const parentDefinition = parent?.startsWith('definition:')
        ? reference
          ? parseNode(reference.template).getAttribute('ID') || undefined
          : parent.slice('definition:'.length)
        : projection.value?.views.get(parent || '')?.treeId;
      setDefinitionId(parent && parent !== 'main' ? parentDefinition : undefined);
    },
    viewKey: `${tree?.id}:${prefix}`,
    editable: !!model.editor && compatible && !busy && !running,
    editor: model.editor,
    storedDocument,
    addNode,
    importLibrary,
    addSaved: (source: BehaviorTree, position?: { x: number; y: number }) => {
      if (!storedDocument || !model.editor || busy || running) return;
      try {
        if (!source.nativeDocument) throw new Error('Choose an XML subtree for this engine.');
        const next = importSubtreeLibrary(storedDocument, model.editor, source.nativeDocument);
        const id = inspectXml(
          source.nativeDocument.xml,
          source.nativeDocument.runtime,
          source.nativeDocument.mainTreeId
        ).mainTreeId;
        if (!id) throw new Error('Select a main tree in the saved library before inserting it.');
        const roots = childrenOf(next.editor!, displayedTreeId, null);
        const parent =
          !position &&
          roots.length === 1 &&
          nodeTemplate(next, parseNode(roots[0].template).tagName).children === 'many'
            ? roots[0].id
            : null;
        publish({
          ...next,
          editor: addEditorNode(next, next.editor!, displayedTreeId, 'SubTree', { ID: id }, parent, position),
        });
      } catch (err) {
        setError((err as Error).message);
      }
    },
    connect: (parent: string, child: string) =>
      storedDocument && edit(editor => connectEditorNodes(storedDocument, editor, parent, child)),
    disconnect: (id: string) =>
      edit(editor => ({
        ...editor,
        nodes: editor.nodes.map(node =>
          node.id === id ? { ...node, parentId: null, order: editor.nodes.length } : node
        ),
      })),
    remove: (id: string) => edit(editor => removeEditorBranch(editor, id)),
    setAttributes: (id: string, attributes: Record<string, string>) =>
      edit(editor => editAttributes(editor, id, attributes)),
    reorder: (id: string, direction: -1 | 1) => edit(editor => reorderEditorNode(editor, id, direction)),
    move: (positions: Array<{ id: string; x: number; y: number }>) =>
      edit(editor => ({
        ...editor,
        nodes: editor.nodes.map(node => {
          const point = positions.find(position => position.id === node.id);
          return point ? { ...node, position: { x: point.x, y: point.y } } : node;
        }),
      })),
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    undo: () => {
      if (!storedDocument || !history.length || running || busy) return;
      const previous = history[history.length - 1];
      setHistory(history.slice(0, -1));
      setFuture([...future, storedDocument]);
      publish(previous, false);
    },
    redo: () => {
      if (!storedDocument || !future.length || running || busy) return;
      const next = future[future.length - 1];
      setFuture(future.slice(0, -1));
      setHistory([...history, storedDocument]);
      publish(next, false);
    },
    exportTree: () => {
      if (!tree || !storedDocument) return null;
      try {
        return { ...tree, nativeDocument: validateDocument(storedDocument) };
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },

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
