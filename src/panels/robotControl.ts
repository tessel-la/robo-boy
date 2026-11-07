import type { Ros } from 'roslib';
import { controlSessionFor, type ControlStatus } from '../features/robotControl/ControlSession';
import type { RoboBoyRosControlRequestResult } from './types';

export const requirePanelControlSession = (ros: Ros) => {
  const session = controlSessionFor(ros);
  if (!session?.hasRecentStatus()) throw new Error('Robot control gateway is unavailable.');
  return session;
};

const blocker = (status: ControlStatus): string | null => {
  if (!status.ready || status.state === 'blocked' || status.state === 'draining' || status.managing) {
    return status.reason || 'Robot control is not available for new commands.';
  }
  if (status.external?.enabled && (!status.external.ready || !status.external.allowControl)) {
    return status.external.reason || 'Robot-side control is disabled.';
  }
  return null;
};

export const requirePanelRobotControl = (ros: Ros) => {
  const status = requirePanelControlSession(ros).getSnapshot()!;
  const reason = blocker(status);
  if (reason) throw new Error(reason);
  if (status.enabled !== false && !(status.state === 'owned' && status.owner === status.selfId && status.token)) {
    throw new Error('Request robot control before sending an action goal.');
  }
};

/** One explicit acquire/consent request; never retries acquisition or queues a robot command. */
export const requestPanelRobotControl = (ros: Ros, signal: AbortSignal): Promise<RoboBoyRosControlRequestResult> => {
  const session = requirePanelControlSession(ros);
  const initial = session.getSnapshot()!;
  const reason = blocker(initial);
  if (reason) return Promise.reject(new Error(reason));
  if (initial.enabled === false || (initial.owner === initial.selfId && initial.token)) {
    return Promise.resolve({ state: 'owned', message: 'This connection has robot control.' });
  }
  if (initial.request?.state === 'pending' || initial.request?.state === 'accepted') {
    return Promise.resolve({ state: 'pending', message: initial.request.message });
  }
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: Error, value?: RoboBoyRosControlRequestResult) => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve(value!);
    };
    const aborted = () => finish(new Error('Panel control request was cancelled.'));
    const timer = setTimeout(() => finish(new Error('Robot control request timed out. Nothing was run.')), 5000);
    unsubscribe = session.subscribe(() => {
      const status = session.getSnapshot();
      if (!status || !session.hasRecentStatus()) return finish(new Error('Robot control connection was lost.'));
      const blocked = blocker(status);
      if (blocked || status.error) return finish(new Error(blocked || status.error));
      if (status.enabled === false || (status.owner === status.selfId && status.token)) {
        return finish(undefined, { state: 'owned', message: 'This connection has robot control.' });
      }
      if (status.request?.state === 'pending' || status.request?.state === 'accepted') {
        return finish(undefined, { state: 'pending', message: status.request.message });
      }
      if (status.request && ['denied', 'expired', 'cancelled'].includes(status.request.state)) {
        finish(new Error(status.request.message || `Robot control request ${status.request.state}.`));
      }
    });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) return aborted();
    try {
      session.command(initial.owner ? 'request' : 'acquire');
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
};
