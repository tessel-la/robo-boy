import { v4 as uuidv4 } from 'uuid';
import ROSLIB, { Ros, Topic } from 'roslib';
import { NativeTreeDocument, RuntimeEvent, RuntimeState, RuntimeSession } from './types';
import { validateDocument } from './xml';

export const RUNTIME_COMMAND_TOPIC = '/robo_boy/bt/command';
export const RUNTIME_EVENTS_TOPIC = '/robo_boy/bt/events';
const initialState = (): RuntimeState => ({ connected: false, runtimes: [], session: null, logs: [], error: null });

function parseEvent(message: unknown): RuntimeEvent | null {
  try {
    const data = (message as { data?: unknown })?.data;
    if (typeof data !== 'string' || data.length > 4 * 1024 * 1024) return null;
    const event = JSON.parse(data);
    if (
      event.protocolVersion !== 2 ||
      typeof event.hostId !== 'string' ||
      !Number.isSafeInteger(event.sequence) ||
      !['response', 'snapshot', 'log'].includes(event.type)
    )
      return null;
    if (event.error !== undefined && typeof event.error !== 'string') return null;
    if (
      event.log &&
      (typeof event.log.type !== 'string' ||
        (event.log.id !== undefined && typeof event.log.id !== 'string') ||
        (event.log.message !== undefined && typeof event.log.message !== 'string') ||
        (event.log.error !== undefined && typeof event.log.error !== 'string'))
    )
      return null;
    if (
      event.runtimes &&
      (!Array.isArray(event.runtimes) ||
        event.runtimes.some(
          (r: any) =>
            !['btcpp', 'py_trees'].includes(r.id) ||
            typeof r.available !== 'boolean' ||
            (r.reason !== undefined && typeof r.reason !== 'string') ||
            (r.enabled !== undefined && typeof r.enabled !== 'boolean') ||
            (r.version !== undefined && typeof r.version !== 'string') ||
            (r.nodes !== undefined &&
              (!Array.isArray(r.nodes) || r.nodes.some((name: unknown) => typeof name !== 'string')))
        ))
    )
      return null;
    if (
      event.session &&
      (typeof event.session.id !== 'string' ||
        !['btcpp', 'py_trees'].includes(event.session.runtime) ||
        (event.session.xml !== undefined && typeof event.session.xml !== 'string') ||
        (event.session.mainTreeId !== undefined && typeof event.session.mainTreeId !== 'string') ||
        (event.session.error != null && typeof event.session.error !== 'string') ||
        !['loaded', 'running', 'completed', 'stopped', 'cancelled', 'error'].includes(event.session.state) ||
        !Array.isArray(event.session.nodes) ||
        event.session.nodes.some(
          (n: any) =>
            typeof n.id !== 'string' ||
            typeof n.label !== 'string' ||
            typeof n.type !== 'string' ||
            typeof n.nativeStatus !== 'string' ||
            typeof n.feedback !== 'string' ||
            (n.ports !== undefined &&
              (n.ports === null ||
                typeof n.ports !== 'object' ||
                Array.isArray(n.ports) ||
                Object.values(n.ports).some(value => typeof value !== 'string'))) ||
            (n.lastResult !== undefined && !['success', 'failure'].includes(n.lastResult)) ||
            (n.lastNativeResult !== undefined && typeof n.lastNativeResult !== 'string') ||
            (n.parentId !== null && typeof n.parentId !== 'string') ||
            !['idle', 'running', 'success', 'failure'].includes(n.status)
        ))
    )
      return null;
    return event as RuntimeEvent;
  } catch {
    return null;
  }
}

/** One remote lifecycle interface for both adapters. ROS owns the executable session. */
export class RemoteTreeRuntime {
  private state = initialState();
  private readonly listeners = new Set<(state: RuntimeState) => void>();
  private readonly commandTopic: Topic;
  private readonly eventsTopic: Topic;
  private readonly pending = new Map<
    string,
    { resolve: (event: RuntimeEvent) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private hostId: string | null = null;
  private sequence = -1;
  private lastSeen = Date.now();
  private readonly retiredHosts = new Set<string>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(private readonly ros: Ros) {
    this.commandTopic = new ROSLIB.Topic({ ros, name: RUNTIME_COMMAND_TOPIC, messageType: 'std_msgs/msg/String' });
    this.eventsTopic = new ROSLIB.Topic({ ros, name: RUNTIME_EVENTS_TOPIC, messageType: 'std_msgs/msg/String' });
    this.eventsTopic.subscribe(this.receive);
    ros.on('close', this.disconnected);
    ros.on('error', this.disconnected);
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 5000 && this.state.connected) this.disconnected();
    }, 1000);
  }

  getState = (): RuntimeState => this.state;
  subscribe(listener: (state: RuntimeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<RuntimeState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener(this.state));
  }
  private failPending(message: string) {
    this.pending.forEach(pending => {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    });
    this.pending.clear();
  }
  private readonly disconnected = () => {
    this.failPending('The ROS host runtime connection was lost.');
    this.update({
      connected: false,
      error: 'ROS host runtime unavailable. Reconnect or retry discovery. Remote execution may still be running.',
    });
  };
  private readonly receive = (message: unknown) => {
    const event = parseEvent(message);
    if (!event || this.disposed || this.retiredHosts.has(event.hostId)) return;
    if (this.hostId && event.hostId !== this.hostId) {
      this.retiredHosts.add(this.hostId);
      this.failPending('The host runtime restarted. Reload its status.');
      this.sequence = -1;
      this.update({ session: null, logs: [] });
    }
    this.hostId = event.hostId;
    this.lastSeen = Date.now();
    // An idempotent response may be older than a snapshot; resolve it without replaying old state.
    const pending = event.requestId ? this.pending.get(event.requestId) : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(event.requestId!);
      if (event.ok) pending.resolve(event);
      else pending.reject(new Error(event.error || 'Host command failed.'));
    }
    if (event.sequence <= this.sequence) return;
    this.sequence = event.sequence;
    const source =
      event.session?.xml ?? (event.session?.id === this.state.session?.id ? this.state.session?.xml : undefined);
    const session =
      event.session && source !== undefined ? ({ ...event.session, xml: source } as RuntimeSession) : undefined;
    const changedRun =
      session && (this.state.session?.id !== session.id || this.state.session?.runId !== session.runId);
    const previousLogs = changedRun ? [] : this.state.logs;
    this.update({
      connected: true,
      error: event.ok === false ? event.error || 'Host command failed.' : null,
      ...(event.runtimes ? { runtimes: event.runtimes } : {}),
      ...(session ? { session } : {}),
      logs: event.log ? [...previousLogs, event.log].slice(-200) : previousLogs,
    });
  };
  private request(command: string, fields: Record<string, unknown> = {}): Promise<RuntimeEvent> {
    if (this.disposed || !this.ros.isConnected) return Promise.reject(new Error('Connect to ROS first.'));
    const requestId = uuidv4();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const error =
          command === 'discover'
            ? 'No Behavior Tree executor responded on this ROS host. Start or update the host executor, then discover engines again.'
            : 'The host did not acknowledge the command. Discover its status before retrying.';
        this.update({ error });
        reject(new Error(error));
      }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.commandTopic.publish(
          new ROSLIB.Message({ data: JSON.stringify({ protocolVersion: 2, requestId, command, ...fields }) })
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
  discover = () => this.request('discover');
  setEnabled = (runtime: NativeTreeDocument['runtime'], enabled: boolean) =>
    this.request('set_enabled', { runtime, enabled });
  status = () => this.request('status');
  validate(document: NativeTreeDocument) {
    return this.request('validate', { ...validateDocument(document) });
  }
  load(document: NativeTreeDocument) {
    return this.request('load', { ...validateDocument(document) });
  }
  private control(command: string) {
    if (!this.state.connected) return Promise.reject(new Error('Host runtime unavailable. Discover its status first.'));
    if (!this.state.session) return Promise.reject(new Error('Load a tree first.'));
    return this.request(command, { sessionId: this.state.session.id });
  }
  start = () => this.control('start');
  stop = () => this.control('stop');
  cancel = () => this.control('cancel');
  reset = () => this.control('reset');
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.heartbeat);
    this.failPending('Runtime client closed.');
    this.eventsTopic.unsubscribe();
    this.commandTopic.unadvertise();
    this.ros.off('close', this.disconnected);
    this.ros.off('error', this.disconnected);
    this.listeners.clear();
  }
}
