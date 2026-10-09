import type { Ros } from 'roslib';
import { defaultSessionName, rememberSessionName } from './sessionName';

export const CONTROL_STATUS_TOPIC = '/roboboy/control/status';
export interface ControlStatus {
  version: 1;
  selfId: string;
  owner: string | null;
  ownerLabel?: string;
  token: string | null;
  state: 'available' | 'owned' | 'draining' | 'blocked';
  ready: boolean;
  pending: number;
  adoptable: boolean;
  managing: boolean;
  leaseMs: number;
  reason: string;
  error: string;
  clients: { id: string; label: string }[];
  requests?: { id: string; clientId: string; label: string; ownerApproved?: boolean; externalApproved?: boolean }[];
  external?: { enabled: boolean; ready: boolean; allowControl: boolean; reason: string };
  request?: {
    id: string;
    state: 'pending' | 'accepted' | 'granted' | 'denied' | 'expired' | 'cancelled';
    message: string;
  } | null;
}

type WireMessage = Record<string, unknown>;
type ControlRos = Ros & { callOnConnection?: (message: WireMessage) => void };
const sessions = new WeakMap<Ros, ControlSession>();

/** Connection-scoped UX and lease token transport. The robot gateway owns policy. */
export class ControlSession {
  private status: ControlStatus | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly send: ((message: WireMessage) => void) | undefined;
  private readonly original: ControlRos['callOnConnection'];
  private readonly ros: ControlRos;
  private heartbeat?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setInterval>;
  private seen = 0;
  private disposed = false;
  private named = false;
  private nameRevision = 0;
  private pendingName?: { label: string; persist: boolean };

  constructor(ros: Ros) {
    this.ros = ros;
    this.original = this.ros.callOnConnection;
    this.send = this.original?.bind(ros);
    // Preserve ROSLIB's receiver even when Topic captures callOnConnection.
    if (this.send)
      this.ros.callOnConnection = message => {
        const { controlToken: _ignored, ...command } = message;
        // Unknown gateways reject the envelope: never silently fall back to
        // sending unchecked commands to a legacy rosbridge.
        this.send?.({ op: 'roboboy_frame', message: { ...command, controlToken: this.status?.token ?? undefined } });
      };
    ros.on(CONTROL_STATUS_TOPIC, this.receive);
    this.watchdog = setInterval(() => {
      if (this.status && Date.now() - this.seen >= this.status.leaseMs) this.closed();
    }, 1000);
    sessions.set(ros, this);
  }

  connected = () => {
    this.send?.({ op: 'subscribe', topic: CONTROL_STATUS_TOPIC });
    this.send?.({ op: 'roboboy_control', action: 'status' });
    if (!this.named) {
      this.named = true;
      const revision = this.nameRevision;
      void defaultSessionName().then(label => {
        if (!label || this.disposed || revision !== this.nameRevision) return;
        this.pendingName = { label, persist: false };
        this.send?.({ op: 'roboboy_control', action: 'identify', label });
      });
    }
  };
  private readonly closed = () => {
    this.status = null;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.listeners.forEach(listener => listener());
  };
  private readonly receive = (message: { data?: unknown }) => {
    try {
      if (typeof message?.data !== 'string') return;
      const status = JSON.parse(message.data) as ControlStatus;
      if (
        status.version !== 1 ||
        typeof status.selfId !== 'string' ||
        !['available', 'owned', 'draining', 'blocked'].includes(status.state) ||
        !Array.isArray(status.clients) ||
        typeof status.leaseMs !== 'number' ||
        status.leaseMs < 3000 ||
        typeof status.ready !== 'boolean' ||
        typeof status.reason !== 'string' ||
        typeof status.error !== 'string' ||
        typeof status.adoptable !== 'boolean' ||
        typeof status.managing !== 'boolean' ||
        !Number.isSafeInteger(status.pending) ||
        status.pending < 0 ||
        (status.owner !== null && typeof status.owner !== 'string') ||
        (status.token !== null && typeof status.token !== 'string') ||
        (status.external !== undefined &&
          (typeof status.external?.enabled !== 'boolean' ||
            typeof status.external?.ready !== 'boolean' ||
            typeof status.external?.allowControl !== 'boolean' ||
            typeof status.external?.reason !== 'string')) ||
        (status.requests !== undefined &&
          (!Array.isArray(status.requests) ||
            !status.requests.every(
              request =>
                typeof request?.id === 'string' &&
                typeof request?.clientId === 'string' &&
                typeof request?.label === 'string' &&
                (request.ownerApproved === undefined || typeof request.ownerApproved === 'boolean') &&
                (request.externalApproved === undefined || typeof request.externalApproved === 'boolean')
            ))) ||
        (status.request != null &&
          (typeof status.request.id !== 'string' ||
            typeof status.request.message !== 'string' ||
            !['pending', 'accepted', 'granted', 'denied', 'expired', 'cancelled'].includes(status.request.state))) ||
        !status.clients.every(client => typeof client?.id === 'string' && typeof client?.label === 'string')
      )
        return;
      this.status = status;
      if (
        this.pendingName &&
        status.clients.find(client => client.id === status.selfId)?.label === this.pendingName.label
      ) {
        if (this.pendingName.persist) rememberSessionName(this.pendingName.label);
        this.pendingName = undefined;
      }
      this.seen = Date.now();
      if (status.owner === status.selfId && status.token) {
        this.heartbeat ??= setInterval(() => this.command('heartbeat'), 2000);
      } else {
        clearInterval(this.heartbeat);
        this.heartbeat = undefined;
      }
      this.listeners.forEach(listener => listener());
    } catch {
      /* Malformed status never grants control. */
    }
  };

  getSnapshot = () => this.status;
  hasRecentStatus = () => Boolean(this.status && Date.now() - this.seen < this.status.leaseMs);
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  command(
    action:
      | 'acquire'
      | 'release'
      | 'transfer'
      | 'identify'
      | 'heartbeat'
      | 'adopt'
      | 'request'
      | 'cancel_request'
      | 'approve'
      | 'deny',
    extra: { label?: string; target?: string; requestId?: string } = {}
  ) {
    if (action === 'identify') {
      ++this.nameRevision;
      if (extra.label) this.pendingName = { label: extra.label, persist: true };
    }
    this.send?.({ op: 'roboboy_control', action, token: this.status?.token, ...extra });
  }
  dispose() {
    this.disposed = true;
    // Closing the socket releases the lease. An explicit release command also
    // stops persistent work, so it belongs to the user's Release button only.
    clearInterval(this.heartbeat);
    clearInterval(this.watchdog);
    this.ros.off?.(CONTROL_STATUS_TOPIC, this.receive);
    this.ros.callOnConnection = this.original;
    sessions.delete(this.ros);
    this.closed();
  }
}
export const controlSessionFor = (ros: Ros | null) => (ros ? sessions.get(ros) : undefined);
