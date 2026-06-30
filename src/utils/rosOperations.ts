import ROSLIB, { Ros } from 'roslib';

export type RosOperation =
  | { kind: 'topic'; name: string; messageType: string; payload?: Record<string, unknown> }
  | { kind: 'service'; name: string; messageType: string; payload?: Record<string, unknown>; timeoutMs?: number }
  | { kind: 'action'; name: string; messageType: string; payload?: Record<string, unknown>; timeoutMs?: number };

type ActionResult = { op?: string; id?: string; result?: boolean; status?: number; values?: unknown };
type ActionListener = (message: ActionResult) => void;
type BridgedRos = Ros & { __operationListeners?: Set<ActionListener>; socket?: any };

const ensureActionBridge = (ros: Ros) => {
  const bridged = ros as BridgedRos;
  bridged.__operationListeners ??= new Set();
  const socket = bridged.socket;
  if (!socket || socket.__rosOperationBridge) return;
  const original = typeof socket.onmessage === 'function' ? socket.onmessage.bind(socket) : null;
  socket.onmessage = (event: { data?: unknown }) => {
    if (typeof event?.data === 'string') {
      try {
        const message = JSON.parse(event.data) as ActionResult;
        if (message.op === 'action_result') bridged.__operationListeners?.forEach(listener => listener(message));
      } catch { /* roslib handles non-JSON frames */ }
    }
    original?.(event);
  };
  socket.__rosOperationBridge = true;
};

const createRequestId = () => `pad-operation-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const executeRosOperation = async (
  ros: Ros,
  operation: RosOperation,
  signal?: AbortSignal
): Promise<unknown> => {
  if (signal?.aborted) throw new Error('Operation cancelled.');

  if (operation.kind === 'topic') {
    const topic = new ROSLIB.Topic({ ros, name: operation.name, messageType: operation.messageType });
    topic.advertise();
    topic.publish(new ROSLIB.Message(operation.payload || {}));
    topic.unadvertise();
    return undefined;
  }

  if (operation.kind === 'service') {
    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({ ros, name: operation.name, serviceType: operation.messageType });
      let settled = false;
      const finish = (error?: unknown, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(new Error('Operation cancelled.'));
      const timer = setTimeout(() => finish(new Error('Service call timed out.')), operation.timeoutMs || 10000);
      signal?.addEventListener('abort', onAbort, { once: true });
      service.callService(
        new ROSLIB.ServiceRequest(operation.payload || {}),
        result => finish(undefined, result),
        error => finish(error || new Error('Service call failed.'))
      );
    });
  }

  return new Promise((resolve, reject) => {
    const bridged = ros as BridgedRos;
    ensureActionBridge(ros);
    const id = createRequestId();
    let settled = false;
    const finish = (error?: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bridged.__operationListeners?.delete(onResult);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const cancel = () => {
      try { (ros as any).callOnConnection({ op: 'cancel_action_goal', id, action: operation.name }); } catch { /* best effort */ }
    };
    const onAbort = () => { cancel(); finish(new Error('Operation cancelled.')); };
    const onResult: ActionListener = message => {
      if (message.id !== id) return;
      if (message.result === false || message.status !== 4) {
        finish(new Error(`Action failed with status ${message.status ?? 'unknown'}.`));
      } else {
        finish(undefined, message.values);
      }
    };
    const timer = setTimeout(() => {
      cancel();
      finish(new Error('Action call timed out.'));
    }, operation.timeoutMs || 60000);
    bridged.__operationListeners?.add(onResult);
    signal?.addEventListener('abort', onAbort, { once: true });
    (ros as any).callOnConnection({
      op: 'send_action_goal',
      id,
      action: operation.name,
      action_type: operation.messageType,
      args: operation.payload || {},
    });
  });
};
