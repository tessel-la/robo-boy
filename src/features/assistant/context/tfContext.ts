import ROSLIB, { Ros } from 'roslib';
import type { AssistantCapability } from '../capabilities';
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
  frames: string[];
  requestedSource: string;
  requestedTarget: string;
  resolvedSource: string | null;
  resolvedTarget: string | null;
}

const abortError = () => new DOMException('TF lookup cancelled.', 'AbortError');

const canonicalFrame = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');

const resolveFrameHint = (hint: string, frames: Iterable<string>): string | null => {
  const normalizedHint = canonicalFrame(hint);
  if (!normalizedHint) return null;
  const candidates = [...frames];
  return (
    candidates.find(frame => canonicalFrame(frame) === normalizedHint) ??
    candidates.find(frame => canonicalFrame(frame).endsWith(normalizedHint) || normalizedHint.endsWith(canonicalFrame(frame))) ??
    null
  );
};

export interface ParsedTransformRequest {
  sourceFrame: string;
  targetFrame: string;
}

export interface ParsedDistanceRequest extends ParsedTransformRequest {}

/** Accepts ordinary phrasing, including abbreviated "btw" and human-spaced frame names. */
/** Declared here so it cannot drift from the two parsers below; `capabilities.test.ts` feeds every
 * phrasing through them. */
export const TF_CAPABILITY: AssistantCapability = {
  id: 'tf-transform-distance',
  summary:
    'Transforms and distances between two TF frames are computed for the user, live and exactly, from `/tf` and `/tf_static` — before this conversation is even consulted.',
  detail: [
    'When they ask whether that is possible without naming both frames, answer yes and tell them to ask for it by frame. Never describe writing a TF listener, a tf2_ros node, or a script.',
  ],
  invocations: [
    'transform between base_link and camera_link',
    'distance between base_link and camera_link',
    'distance btw panda_link0 and panda_hand',
    'transform from odom to base_link',
  ],
};

export const parseTransformRequest = (text: string): ParsedTransformRequest | null => {
  const compact = text.replace(/[`"']/g, '').replace(/\s+/g, ' ').trim();
  const match = compact.match(
    /\btransform\b.*?\b(?:between|btw|from)\s+(.+?)\s+(?:and|to|->|→)\s+(.+?)(?:[?.!,;]|$)/i
  );
  if (!match) return null;
  const sourceFrame = match[1].trim();
  const targetFrame = match[2].trim();
  return sourceFrame && targetFrame ? { sourceFrame, targetFrame } : null;
};

/** Frame-pair parser for Euclidean distance questions. The actual value is derived from the same
 * composed TF transform as a transform lookup, so distance and transform answers cannot diverge. */
export const parseDistanceRequest = (text: string): ParsedDistanceRequest | null => {
  const compact = text.replace(/[`"']/g, '').replace(/\s+/g, ' ').trim();
  const match = compact.match(
    /\bdistance\b.*?\b(?:between|btw|from)\s+(.+?)\s+(?:and|to|->|→)\s+(.+?)(?:[?.!,;]|$)/i
  );
  if (!match) return null;
  const sourceFrame = match[1].trim();
  const targetFrame = match[2].trim();
  return sourceFrame && targetFrame ? { sourceFrame, targetFrame } : null;
};

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
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<TfLookupResult> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let state: TfTreeState = createEmptyTfTreeState();
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

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

    const resultFor = (transform: TfCalculatedTransform | null, timedOut: boolean): TfLookupResult => {
      const resolvedSource = resolveFrameHint(sourceFrame, state.knownFrames);
      const resolvedTarget = resolveFrameHint(targetFrame, state.knownFrames);
      return {
        transform,
        diagnostics: getTfGraphDiagnostics(state),
        timedOut,
        frames: [...state.knownFrames].sort(),
        requestedSource: sourceFrame,
        requestedTarget: targetFrame,
        resolvedSource,
        resolvedTarget,
      };
    };

    const finish = (result: TfLookupResult, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dynamicTopic.unsubscribe();
      staticTopic.unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
    };

    const onAbort = () => finish(resultFor(null, false), abortError());

    const handle = (source: 'dynamic' | 'static') => (message: unknown) => {
      state = consumeTfMessage(state, message as { transforms?: unknown }, source, Date.now());
      const resolvedSource = resolveFrameHint(sourceFrame, state.knownFrames);
      const resolvedTarget = resolveFrameHint(targetFrame, state.knownFrames);
      const transform = resolvedSource && resolvedTarget ? calculateTfBetweenFrames(state, resolvedSource, resolvedTarget) : null;
      if (transform) finish(resultFor(transform, false));
    };

    dynamicTopic.subscribe(handle('dynamic'));
    staticTopic.subscribe(handle('static'));
    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      const resolvedSource = resolveFrameHint(sourceFrame, state.knownFrames);
      const resolvedTarget = resolveFrameHint(targetFrame, state.knownFrames);
      const transform = resolvedSource && resolvedTarget ? calculateTfBetweenFrames(state, resolvedSource, resolvedTarget) : null;
      finish(resultFor(transform, true));
    }, timeoutMs);
  });

export const captureTfSnapshotOnDemand = (
  ros: Ros,
  timeoutMs = 1800,
  signal?: AbortSignal
): Promise<TfLookupResult> => lookupTransformOnDemand(ros, '__snapshot__', '__snapshot__', timeoutMs, signal);
