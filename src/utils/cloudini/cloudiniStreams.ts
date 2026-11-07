import { Topic, type Ros } from 'roslib';
import type { PointCloudMessage } from '../pointCloudDecoder';
import { CLOUDINI_TYPE, cloudiniMessage } from './cloudiniMessage';

type Event = { message?: PointCloudMessage; error?: string };
const streams = new WeakMap<Ros, Map<string, Stream>>();

class Stream {
  listeners = new Set<(event: Event) => void>();
  event: Event = {};
  private subscription: Topic;
  private worker?: Worker;
  private busy = false;
  private pending?: { message: unknown };
  private timeout?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(ros: Ros, name: string) {
    this.subscription = new Topic({
      ros,
      name,
      messageType: CLOUDINI_TYPE,
      compression: 'cbor',
      throttle_rate: 33,
      queue_length: 1,
    });
    this.subscription.subscribe(message => {
      if (this.disposed) return;
      this.pending = { message };
      this.pump();
    });
  }
  private notify(event: Event) {
    if (this.disposed) return;
    this.event = event;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Point-cloud consumer failed:', error);
      }
    }
  }
  private pump() {
    if (this.disposed || this.busy || !this.pending) return;
    const next = this.pending;
    this.pending = undefined;
    this.busy = true;
    try {
      const { message, bytes } = cloudiniMessage(next.message);
      if (!this.worker) {
        const worker = (this.worker = new Worker(new URL('./cloudini.worker.ts', import.meta.url), { type: 'module' }));
        this.worker.onmessage = ({ data }: MessageEvent<Event>) => {
          if (this.disposed || this.worker !== worker) return;
          clearTimeout(this.timeout);
          this.busy = false;
          this.notify(data);
          this.pump();
        };
        this.worker.onerror = event => {
          if (this.disposed || this.worker !== worker) return;
          event.preventDefault();
          this.failed('Point-cloud decoder failed.');
        };
      }
      this.timeout = setTimeout(() => this.failed('Point-cloud decoding timed out.'), 5000);
      this.worker.postMessage({
        format: 'cloudini',
        header: message.header,
        width: message.width,
        height: message.height,
        point_step: message.point_step,
        row_step: message.row_step,
        fields: message.fields,
        is_bigendian: false,
        compressed_data: bytes,
      });
    } catch (error) {
      this.failed(error instanceof Error ? error.message : 'Point-cloud decoder could not start.');
    }
  }
  private failed(error: string) {
    clearTimeout(this.timeout);
    this.worker?.terminate();
    this.worker = undefined;
    this.busy = false;
    this.notify({ error });
    this.pump();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timeout);
    this.subscription.unsubscribe();
    this.worker?.terminate();
    this.worker = undefined;
    this.pending = undefined;
    this.event = {};
    this.listeners.clear();
  }
}

/** One subscription/worker and one newest pending frame per connection/topic. Last unsubscribe releases the WASM heap. */
export function subscribeCloudini(ros: Ros, name: string, listener: (event: Event) => void) {
  let topics = streams.get(ros);
  if (!topics) streams.set(ros, (topics = new Map()));
  let stream = topics.get(name);
  if (!stream) topics.set(name, (stream = new Stream(ros, name)));
  stream.listeners.add(listener);
  listener(stream.event);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    stream!.listeners.delete(listener);
    if (!stream!.listeners.size) {
      stream!.dispose();
      topics!.delete(name);
    }
  };
}
