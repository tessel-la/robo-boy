import * as ROSLIB from 'roslib';
import type { Ros, Topic } from 'roslib';
import { decodeImageFrame, type DecodedImageFrame } from './decodeImage';
import { parseCameraInfo, type CameraCalibration } from './cameraCalibration';

type ImageEvent = { frame: DecodedImageFrame | null; error: string | null };
type InfoEvent = { samples: readonly CameraCalibration[]; error: string | null };
const imageStreams = new WeakMap<Ros, Map<string, ImageStream>>();
const infoStreams = new WeakMap<Ros, Map<string, InfoStream>>();
function notify<T>(listeners: Iterable<(event: T) => void>, event: T) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('Camera consumer failed:', error);
    }
  }
}
function closeFrame(frame: DecodedImageFrame | null) {
  if (frame && 'close' in frame.image) frame.image.close();
}

class ImageStream {
  listeners = new Set<(event: ImageEvent) => void>();
  event: ImageEvent = { frame: null, error: null };
  private subscription: Topic;
  private pending?: { message: unknown };
  private scheduled = 0;
  private busy = false;
  private disposed = false;
  constructor(
    ros: Ros,
    name: string,
    private type: string
  ) {
    this.subscription = new ROSLIB.Topic({
      ros,
      name,
      messageType: type,
      compression: 'cbor',
      throttle_rate: 100,
      queue_length: 1,
    });
    this.subscription.subscribe(message => {
      this.pending = { message };
      this.schedule();
    });
  }
  private schedule() {
    if (!this.disposed && !this.busy && !this.scheduled && this.pending)
      this.scheduled = requestAnimationFrame(() => void this.decode());
  }
  private async decode() {
    this.scheduled = 0;
    const next = this.pending;
    this.pending = undefined;
    if (this.disposed || !next) return;
    this.busy = true;
    try {
      const frame = await decodeImageFrame(next.message, this.type);
      if (this.disposed) {
        closeFrame(frame);
        return;
      }
      const previous = this.event.frame;
      this.event = { frame, error: null };
      notify(this.listeners, this.event);
      closeFrame(previous);
    } catch (error) {
      if (!this.disposed) {
        const previous = this.event.frame;
        this.event = {
          frame: null,
          error:
            error instanceof Error ? error.message.replace(/^Replay/, 'Camera') : 'Camera image could not be decoded.',
        };
        notify(this.listeners, this.event);
        closeFrame(previous);
      }
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.scheduled);
    this.subscription.unsubscribe();
    closeFrame(this.event.frame);
    this.event = { frame: null, error: null };
    this.pending = undefined;
  }
}

/** One ROS subscription, one decoder, one in-flight frame and one newest pending frame per source/topic. */
export function subscribeToImages(ros: Ros, name: string, type: string, listener: (event: ImageEvent) => void) {
  let streams = imageStreams.get(ros);
  if (!streams) imageStreams.set(ros, (streams = new Map()));
  // Normalize ROS spelling so identical topics never open duplicate decoders.
  const key = `${name}\0${type.replace('/msg/', '/')}`;
  let stream = streams.get(key);
  if (!stream) streams.set(key, (stream = new ImageStream(ros, name, type)));
  stream.listeners.add(listener);
  notify([listener], stream.event);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    stream!.listeners.delete(listener);
    if (!stream!.listeners.size) {
      stream!.dispose();
      streams!.delete(key);
    }
  };
}

class InfoStream {
  listeners = new Set<(event: InfoEvent) => void>();
  event: InfoEvent = { samples: [], error: null };
  private subscription: Topic;
  constructor(ros: Ros, name: string) {
    this.subscription = new ROSLIB.Topic({
      ros,
      name,
      messageType: 'sensor_msgs/CameraInfo',
      compression: 'cbor',
      queue_length: 1,
    });
    this.subscription.subscribe(message => {
      try {
        const sample = parseCameraInfo(message);
        const samples = this.event.samples.filter(item => item.frame === sample.frame && item.stamp !== sample.stamp);
        samples.push(sample);
        this.event = { samples: samples.slice(-64), error: null };
      } catch (error) {
        this.event = { samples: [], error: error instanceof Error ? error.message : 'CameraInfo is invalid.' };
      }
      notify(this.listeners, this.event);
    });
  }
  dispose() {
    this.subscription.unsubscribe();
    this.event = { samples: [], error: null };
  }
}

/** Small bounded calibration history; a bad replacement fails closed instead of reusing stale intrinsics. */
export function subscribeToCameraInfo(ros: Ros, name: string, listener: (event: InfoEvent) => void) {
  let streams = infoStreams.get(ros);
  if (!streams) infoStreams.set(ros, (streams = new Map()));
  let stream = streams.get(name);
  if (!stream) streams.set(name, (stream = new InfoStream(ros, name)));
  stream.listeners.add(listener);
  notify([listener], stream.event);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    stream!.listeners.delete(listener);
    if (!stream!.listeners.size) {
      stream!.dispose();
      streams!.delete(name);
    }
  };
}
