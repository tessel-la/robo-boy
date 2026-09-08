import ROSLIB, { Ros } from 'roslib';
import {
  consumeTfMessage,
  createEmptyTfTreeState,
  getTfGraphDiagnostics,
  type TfGraphDiagnostics,
  type TfTreeState,
} from '../../tfTree/tfTreeModel';
import { calculateTfBetweenFrames, type TfCalculatedTransform } from '../../tfTree/tfTreeCalculator';

const DEFAULT_TIMEOUT_MS = 4000;

export interface TfLookupResult {
  transform: TfCalculatedTransform | null;
  diagnostics: TfGraphDiagnostics;
  timedOut: boolean;
}

/**
 * On-demand transform lookup for the assistant's TF tool. Deliberately not a background
 * subscription: it subscribes to `/tf` + `/tf_static` only for the duration of one lookup, then
 * unsubscribes — matching the "no unbounded live samples" rule and the app's convention of
 * releasing ROS subscriptions when not actively needed. Reuses the same pure model/calculator the
 * TF Tree panel uses, so a disconnected-graph diagnosis matches what that panel would show.
 */
export const lookupTransformOnDemand = (
  ros: Ros,
  sourceFrame: string,
  targetFrame: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<TfLookupResult> =>
  new Promise(resolve => {
    let state: TfTreeState = createEmptyTfTreeState();
    let settled = false;

    const dynamicTopic = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/msg/TFMessage',
      throttle_rate: 25,
      queue_length: 1,
    });
    const staticTopic = new ROSLIB.Topic({
      ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/msg/TFMessage',
      queue_length: 1,
    });

    const finish = (result: TfLookupResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dynamicTopic.unsubscribe();
      staticTopic.unsubscribe();
      resolve(result);
    };

    const handle = (source: 'dynamic' | 'static') => (message: unknown) => {
      state = consumeTfMessage(state, message as { transforms?: unknown }, source, Date.now());
      const transform = calculateTfBetweenFrames(state, sourceFrame, targetFrame);
      if (transform) finish({ transform, diagnostics: getTfGraphDiagnostics(state), timedOut: false });
    };

    dynamicTopic.subscribe(handle('dynamic'));
    staticTopic.subscribe(handle('static'));

    const timer = setTimeout(() => {
      finish({ transform: null, diagnostics: getTfGraphDiagnostics(state), timedOut: true });
    }, timeoutMs);
  });
