import type { Ros } from 'roslib';
import {
  isJsonObject,
  type RoboBoyJsonObject,
  type RoboBoyRosActionOptions,
  type RoboBoyRosActionResult,
} from './types';

const MAX_ACTION_GOALS = 16;
const MAX_ACTION_BYTES = 1024 * 1024;
const CANCEL_INTERVAL_MS = 1000;
const connectionGoals = new WeakMap<Ros, Set<string>>();

type ActionRos = Ros & {
  socket?: WebSocket;
  callOnConnection(message: Record<string, unknown>): void;
};

interface Goal {
  action: string;
  resolve(value: RoboBoyRosActionResult): void;
  reject(error: Error): void;
  feedback?(value: RoboBoyJsonObject): void;
  cancelTimer?: ReturnType<typeof setInterval>;
}

const jsonPayload = (value: unknown): value is RoboBoyJsonObject =>
  isJsonObject(value) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_ACTION_BYTES;

/** Tile-owned ROS 2 goals, sent through ControlSession's existing command envelope. */
export class PanelRosActions {
  private readonly ros: ActionRos;
  private readonly socket: WebSocket;
  private readonly goals = new Map<string, Goal>();
  private disposed = false;
  private listening = false;

  constructor(ros: Ros) {
    this.ros = ros as ActionRos;
    if (!this.ros.socket?.addEventListener) throw new Error('ROS action transport is unavailable.');
    this.socket = this.ros.socket;
  }

  isCurrent(ros: Ros | null) {
    return this.ros === ros && this.socket === this.ros.socket;
  }

  send(options: RoboBoyRosActionOptions, feedback?: Goal['feedback']) {
    if (this.disposed || this.ros.isConnected !== true || !this.isCurrent(this.ros)) {
      throw new Error('ROS action transport is disconnected.');
    }
    const active = connectionGoals.get(this.ros) ?? new Set<string>();
    connectionGoals.set(this.ros, active);
    if (active.size >= MAX_ACTION_GOALS) throw new Error('Panel ROS action goal limit reached.');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const goalId = `panel-action-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const result = new Promise<RoboBoyRosActionResult>((resolve, reject) => {
      this.goals.set(goalId, { action: options.action, resolve, reject, feedback });
    });
    // A synchronous send failure can reject before the broker attaches its result handler.
    void result.catch(() => {});
    active.add(goalId);
    if (!this.listening) {
      this.listening = true;
      // ROSLIB 1.x does not emit ROS 2 action frames. A separate listener preserves its decoder
      // and the BT/Pad listeners; goals explicitly request uncompressed JSON responses.
      this.socket.addEventListener('message', this.receive);
      this.socket.addEventListener('close', this.closed);
      this.ros.on('close', this.closed);
    }
    try {
      this.ros.callOnConnection({
        op: 'send_action_goal',
        id: goalId,
        action: options.action,
        action_type: options.actionType,
        args: options.goal,
        feedback: true,
      });
    } catch (error) {
      this.finish(goalId, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    return { goalId, result };
  }

  cancel(goalId: string) {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error('This panel does not own an active goal with that ID.');
    // Cancellation can race goal registration in rosbridge. Keep requesting until terminal
    // status; an acknowledgement or a local UI disappearing is not proof of completion.
    goal.cancelTimer ??= setInterval(() => this.sendCancel(goalId, goal), CANCEL_INTERVAL_MS);
    this.sendCancel(goalId, goal);
  }

  private sendCancel(goalId: string, goal: Goal) {
    if (this.ros.isConnected !== true || !this.isCurrent(this.ros)) {
      this.closed();
      return;
    }
    try {
      this.ros.callOnConnection({ op: 'cancel_action_goal', id: goalId, action: goal.action });
    } catch {
      // The next tick retries while the same transport is alive. The gateway remains authoritative.
    }
  }

  private readonly receive = (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.id !== 'string') return;
    const goal = this.goals.get(message.id);
    if (!goal || (message.action !== undefined && message.action !== goal.action)) return;
    if (message.op === 'action_feedback') {
      if (!this.disposed && jsonPayload(message.values)) {
        try {
          goal.feedback?.(message.values);
        } catch {
          /* A panel callback cannot break transport dispatch. */
        }
      }
    } else if (message.op === 'action_result') {
      const status = message.status;
      if (status === 4 || status === 5 || status === 6) {
        if (jsonPayload(message.values)) this.finish(message.id, undefined, { status, result: message.values });
        else this.finish(message.id, new Error('ROS action result must be a finite JSON object within 1 MiB.'));
      } else if (message.result === false) {
        const error = new Error(
          typeof message.values === 'string' ? message.values : 'ROS action failed without confirmed completion.'
        );
        if (status === 0 && message.action === goal.action && message.roboboyWorkOutcome === 'not_started') {
          // Only an explicit gateway/rosbridge attestation proves this goal never started.
          // A generic status 0 failure may arrive after submission and must stay tracked.
          this.finish(message.id, error);
          return;
        }
        // A transport failure may leave real work running. Report uncertainty, request cancellation,
        // and retain our listener/retries until a real terminal result or connection loss.
        goal.reject(error);
        this.cancel(message.id);
      }
    }
  };

  private finish(goalId: string, error?: Error, value?: RoboBoyRosActionResult) {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    clearInterval(goal.cancelTimer);
    this.goals.delete(goalId);
    connectionGoals.get(this.ros)?.delete(goalId);
    if (error) goal.reject(error);
    else goal.resolve(value!);
    if (!this.goals.size && this.listening) {
      this.socket.removeEventListener('message', this.receive);
      this.socket.removeEventListener('close', this.closed);
      this.ros.off('close', this.closed);
      this.listening = false;
    }
  }

  private readonly closed = () => {
    for (const id of this.goals.keys())
      this.finish(id, new Error('ROS connection lost; robot completion is unconfirmed.'));
  };

  dispose() {
    this.disposed = true;
    for (const id of this.goals.keys()) {
      this.goals.get(id)!.feedback = undefined;
      this.cancel(id);
    }
    // Cancellation tracking deliberately outlives the tile, bounded per ROS connection.
    // Terminal results or socket closure remove every remaining listener and timer.
  }
}
