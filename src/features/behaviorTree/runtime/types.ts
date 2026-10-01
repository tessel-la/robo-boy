export type TreeRuntimeId = 'btcpp' | 'py_trees';

/** Native source and metadata; an optional visual draft compiles back into the same format. */
export interface NativeTreeDocument {
  runtime: TreeRuntimeId | null;
  xml: string;
  mainTreeId?: string;
  editor?: NativeEditorState;
}

/** Saved visual draft. XML remains the template/metadata source until compilation. */
export interface NativeEditorNode {
  id: string;
  treeId: string;
  parentId: string | null;
  order: number;
  template: string;
  position?: { x: number; y: number };
}
export interface NativeEditorState {
  version: 1;
  nodes: NativeEditorNode[];
}
export interface NativeNodeTemplate {
  defaults: Record<string, string>;
  children: 'none' | 'one' | 'many' | 'host';
}

export type RuntimeNodeStatus = 'idle' | 'running' | 'success' | 'failure';
export interface RuntimeNode {
  id: string;
  parentId: string | null;
  label: string;
  type: string;
  status: RuntimeNodeStatus;
  nativeStatus: string;
  feedback: string;
  ports?: Record<string, string>;
  lastResult?: 'success' | 'failure';
  lastNativeResult?: string;
}

export interface RuntimeDescriptor {
  id: TreeRuntimeId;
  label: string;
  version?: string;
  available: boolean;
  enabled?: boolean;
  reason?: string;
  nodes?: string[];
  rosIntegration?: string;
  capabilities: {
    xml: boolean;
    selfContainedOnly: boolean;
    cancel: boolean;
    reset: boolean;
    feedback: boolean;
    nativeNodes: boolean;
  };
}

export interface RuntimeSession {
  id: string;
  runtime: TreeRuntimeId;
  xml: string;
  mainTreeId?: string;
  state: 'loaded' | 'running' | 'completed' | 'stopped' | 'cancelled' | 'error';
  nodes: RuntimeNode[];
  result: 'success' | 'failure' | null;
  error: string | null;
  startedAt?: number;
  runId?: string | null;
}

export interface RuntimeLog {
  type: string;
  id?: string;
  message?: string;
  feedback?: unknown;
  result?: unknown;
  error?: string;
  success?: boolean;
}

export interface RuntimeState {
  connected: boolean;
  runtimes: RuntimeDescriptor[];
  session: RuntimeSession | null;
  logs: RuntimeLog[];
  error: string | null;
}

export interface RuntimeEvent {
  protocolVersion: 2;
  hostId: string;
  sequence: number;
  type: 'response' | 'snapshot' | 'log';
  requestId?: string;
  ok?: boolean;
  error?: string;
  runtimes?: RuntimeDescriptor[];
  session?: Omit<RuntimeSession, 'xml'> & { xml?: string };
  nodes?: RuntimeNode[];
  log?: RuntimeLog;
}

export interface TreeFormatAdapter {
  id: TreeRuntimeId;
  label: string;
  template: string;
  /** Native topology at a SubTree boundary; execution semantics stay in the backend. */
  subtreeTopology: 'wrapped' | 'inlined';
  editorNodes: Record<string, NativeNodeTemplate>;
  subtreeDefaults(definition: Element): Record<string, string>;
  matches(root: Element): boolean;
  validate(root: Element): void;
}
