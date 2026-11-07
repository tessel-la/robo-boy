import ROSLIB, { type Ros, type Topic } from 'roslib';
import { executeRosOperation } from '../rosOperations';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import { rosStamp } from '../rosTime';
import { decodeImageFrame } from './decodeImage';
import { shareImageFrame } from './sharedImageFrame';
import type { CameraCaptureOptions } from './cameraImageOptions';

function atPath(value: unknown, path: string): unknown {
  if (!path) return value;
  if (path.length > 256) throw new Error('Result field path is too long.');
  for (const key of path.split('.')) {
    if (
      !key ||
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !value ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, key)
    )
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A command binding is explicit. Never probes services, guesses topic names, or bypasses the gateway. */
export async function requestCameraCapture(ros: Ros, options: CameraCaptureOptions, signal: AbortSignal) {
  if (isReplayRos(ros)) throw new Error('Capture commands are unavailable during replay.');
  if (!ros.isConnected) throw new Error('Camera is disconnected.');
  if (
    !['service', 'action'].includes(options.kind) ||
    !/^\/[\w/]+$/.test(options.name) ||
    !/^[\w]+\/(?:srv\/|action\/)?[\w]+$/.test(options.messageType)
  )
    throw new Error('Enter a valid capture service/action name and type.');
  if (!['sensor_msgs/Image', 'sensor_msgs/CompressedImage'].includes(options.imageType))
    throw new Error('Select a supported capture image type.');
  if (options.request.length > 16384) throw new Error('Capture request exceeds 16 KiB.');
  const payload = JSON.parse(options.request || '{}');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Capture request must be a JSON object.');
  const timeoutMs = Math.max(1, Math.min(120, Number.isFinite(options.timeoutSec) ? options.timeoutSec! : 15)) * 1000;
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) abort.abort();
  const timer = setTimeout(onAbort, timeoutMs);
  let topic: Topic | undefined;
  const candidates: { stamp: bigint; message: unknown }[] = [];
  let receiveMatch: (() => void) | undefined;
  try {
    if (options.outputTopic) {
      if (!/^\/[\w/]+$/.test(options.outputTopic) || !options.resultStampPath)
        throw new Error('Topic capture requires a result timestamp field to associate the returned image.');
      topic = new ROSLIB.Topic({
        ros,
        name: options.outputTopic,
        messageType: options.imageType,
        compression: 'cbor',
        queue_length: 1,
      });
      topic.subscribe(message => {
        const stamp = rosStamp((message as { header?: { stamp?: unknown } }).header?.stamp);
        if (stamp === null || stamp === 0n) return;
        candidates.push({ stamp, message });
        if (candidates.length > 4) candidates.shift();
        receiveMatch?.();
      });
    }
    const response = await executeRosOperation(
      ros,
      { kind: options.kind, name: options.name, messageType: options.messageType, payload, timeoutMs },
      abort.signal
    );
    if (response && typeof response === 'object' && (response as { success?: unknown }).success === false)
      throw new Error(String((response as { message?: unknown }).message || 'Camera rejected the capture request.'));
    let message: unknown;
    if (topic) {
      const expected = rosStamp(atPath(response, options.resultStampPath!));
      if (expected === null || expected === 0n) throw new Error('Capture result has no valid acquisition timestamp.');
      message = await new Promise((resolve, reject) => {
        const cancel = () => {
          abort.signal.removeEventListener('abort', cancel);
          reject(new Error('Capture cancelled or timed out.'));
        };
        receiveMatch = () => {
          const match = candidates.find(candidate => candidate.stamp === expected);
          if (match) {
            abort.signal.removeEventListener('abort', cancel);
            resolve(match.message);
          }
        };
        abort.signal.addEventListener('abort', cancel, { once: true });
        if (abort.signal.aborted) cancel();
        else receiveMatch();
      });
    } else message = atPath(response, options.imagePath);
    if (abort.signal.aborted) throw new Error('Capture cancelled or timed out.');
    const decoded = await decodeImageFrame(message, options.imageType);
    if (abort.signal.aborted) {
      if ('close' in decoded.image) decoded.image.close();
      throw new Error('Capture cancelled.');
    }
    return shareImageFrame(decoded);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    topic?.unsubscribe();
    // A service already admitted by the robot cannot be undone by closing this UI.
  }
}
