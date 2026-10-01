export type TreeRuntimeId = 'btcpp' | 'py_trees';

/** Original source is the executable document. The visual graph is a projection only. */
export interface NativeTreeDocument {
  runtime: TreeRuntimeId | null;
  xml: string;
  mainTreeId?: string;
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
  matches(root: Element): boolean;
  validate(root: Element): void;
}
