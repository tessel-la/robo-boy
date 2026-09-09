import ROSLIB, { type Ros } from 'roslib';
import { runSerializedRosapi } from '../../../utils/rosapiQueue';

const DEFAULT_SAMPLE_COUNT = 3;
const DEFAULT_SAMPLE_TIMEOUT_MS = 1800;
const MAX_SAMPLE_BYTES = 24 * 1024;

const abortError = () => new DOMException('ROS context request cancelled.', 'AbortError');

const callRosapi = <T>(
  ros: Ros,
  invoke: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
  signal?: AbortSignal
): Promise<T> =>
  runSerializedRosapi(
    ros,
    () =>
      new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        try {
          invoke(resolve, reject);
        } catch (error) {
          reject(error);
        }
      }),
    signal
  );

const boundedJsonValue = (value: unknown, maxBytes = MAX_SAMPLE_BYTES): unknown => {
  try {
    const serialized = JSON.stringify(value);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes <= maxBytes) return value;
    return {
      truncated: true,
      originalBytes: bytes,
      jsonPreview: serialized.slice(0, Math.min(serialized.length, maxBytes)),
    };
  } catch {
    return { unavailable: 'Message was not JSON serializable.' };
  }
};

export interface TopicSampleResult {
  topic: string;
  messageType: string;
  samples: Array<{ receivedAt: number; value: unknown }>;
  timedOut: boolean;
  limits: { maxMessages: number; timeoutMs: number; maxBytesPerMessage: number };
}

/** Temporary, bounded topic subscription used only after an explicit user request. */
export const sampleRosTopic = (
  ros: Ros,
  topicName: string,
  messageType: string,
  options: { maxMessages?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<TopicSampleResult> => {
  const maxMessages = Math.max(1, Math.min(10, options.maxMessages ?? DEFAULT_SAMPLE_COUNT));
  const timeoutMs = Math.max(100, Math.min(10_000, options.timeoutMs ?? DEFAULT_SAMPLE_TIMEOUT_MS));

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }

    const samples: TopicSampleResult['samples'] = [];
    const topic = new ROSLIB.Topic({
      ros,
      name: topicName,
      messageType,
      throttle_rate: 50,
      queue_length: 1,
    });
    let settled = false;

    const finish = (timedOut: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      topic.unsubscribe();
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve({ topic: topicName, messageType, samples, timedOut, limits: { maxMessages, timeoutMs, maxBytesPerMessage: MAX_SAMPLE_BYTES } });
    };
    const onAbort = () => finish(false, abortError());
    const timer = window.setTimeout(() => finish(true), timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    topic.subscribe(message => {
      if (settled) return;
      samples.push({ receivedAt: Date.now(), value: boundedJsonValue(message) });
      if (samples.length >= maxMessages) finish(false);
    });
  });
};

export const fetchRosNodeNames = (ros: Ros, signal?: AbortSignal): Promise<string[]> =>
  callRosapi(
    ros,
    (resolve, reject) => (ros as any).getNodes((nodes: unknown) => resolve(Array.isArray(nodes) ? nodes.map(String).slice(0, 250) : []), reject),
    signal
  );

export interface RosNodeDetails {
  node: string;
  subscribing: string[];
  publishing: string[];
  services: string[];
}

export const fetchRosNodeDetails = (ros: Ros, node: string, signal?: AbortSignal): Promise<RosNodeDetails> =>
  callRosapi(
    ros,
    (resolve, reject) =>
      (ros as any).getNodeDetails(
        node,
        (subscribing: unknown, publishing: unknown, services: unknown) =>
          resolve({
            node,
            subscribing: Array.isArray(subscribing) ? subscribing.map(String).slice(0, 250) : [],
            publishing: Array.isArray(publishing) ? publishing.map(String).slice(0, 250) : [],
            services: Array.isArray(services) ? services.map(String).slice(0, 250) : [],
          }),
        reject
      ),
    signal
  );

export const fetchRosParameterNames = (ros: Ros, signal?: AbortSignal): Promise<string[]> =>
  callRosapi(
    ros,
    (resolve, reject) => (ros as any).getParams((names: unknown) => resolve(Array.isArray(names) ? names.map(String).slice(0, 250) : []), reject),
    signal
  );

export const fetchRosParameterValue = (ros: Ros, name: string, signal?: AbortSignal): Promise<unknown> =>
  callRosapi(
    ros,
    (resolve, reject) => {
      const parameter = new ROSLIB.Param({ ros, name });
      parameter.get((value: unknown) => resolve(boundedJsonValue(value)), reject);
    },
    signal
  );

export const captureRosout = (ros: Ros, signal?: AbortSignal): Promise<TopicSampleResult> =>
  sampleRosTopic(ros, '/rosout', 'rcl_interfaces/msg/Log', { maxMessages: 40, timeoutMs: 4000, signal });
