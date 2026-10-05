import ROSLIB, { type Ros } from 'roslib';
import { isRemoteBag, type BagInfo, type BagSource, type ReaderRequest, type ReaderResponse, type ReplayMessage } from './types';

type WireMessage = { op: string; id?: string; topic?: string; service?: string; args?: { topic?: string; type?: string } };
type Emitter = { emit: (name: string, value: unknown) => void; removeAllListeners: () => void };
export interface ReplaySnapshot {
  phase: 'empty' | 'loading' | 'ready' | 'seeking' | 'error';
  info?: BagInfo;
  position: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  /** The recording is read in place on the ROS host rather than from this device. */
  remote: boolean;
  /** Playback is waiting for data longer than a frame or two: a slow link or a slow machine. */
  buffering: boolean;
  error?: string;
}
const isTf = (topic: string) => topic === '/tf' || topic === '/tf_static';
type Transform = { child_frame_id: string };

/** A ROSLIB-compatible read adapter with no socket and no publishing path. */
class ReplayRos extends ROSLIB.Ros {
  private subscriptions = new Map<string, string>();
  /** Last message per subscribed topic, so a panel that subscribes later starts from the cursor. */
  private latest = new Map<string, ReplayMessage>();
  /** TF messages are deltas; their latest state is every child frame's last transform. */
  private frames = new Map<string, Map<string, Transform>>();
  constructor(private session: ReplaySession) {
    super({ url: '' });
    this.isConnected = true;
  }
  emitEvent(name: string, value: unknown) { (this as unknown as Emitter).emit(name, value); }
  callOnConnection = (message: WireMessage) => {
    if (message.op === 'subscribe' && message.topic && message.id) {
      this.subscriptions.set(message.id, message.topic);
      const last = this.last(message.topic);
      if (last) queueMicrotask(() => { if (this.subscriptions.has(message.id!)) this.deliver(last); });
      else this.session.refreshTopics();
    } else if (message.op === 'unsubscribe' && message.id) {
      this.subscriptions.delete(message.id.replace(/^unsubscribe:/, 'subscribe:'));
    } else if (message.op === 'call_service' && message.id) {
      const topics = this.session.snapshot.info?.topics.filter(t => !t.error) ?? [];
      let values: unknown;
      if (message.service === '/rosapi/topics') values = { topics: topics.map(t => t.name), types: topics.map(t => t.type) };
      if (message.service === '/rosapi/topic_type') values = { type: topics.find(t => t.name === message.args?.topic)?.type ?? '' };
      if (message.service === '/rosapi/topics_for_type') values = { topics: topics.filter(t => t.type === message.args?.type).map(t => t.name) };
      queueMicrotask(() => this.emitEvent(message.id!, { result: values !== undefined, values: values ?? 'Services are unavailable in local replay.' }));
    }
    // advertise/publish/action operations deliberately have no transport.
  };
  getTopics(callback: (response: { topics: string[]; types: string[] }) => void) {
    const topics = this.session.snapshot.info?.topics.filter(t => !t.error) ?? [];
    callback({ topics: topics.map(t => t.name), types: topics.map(t => t.type) });
  }
  getTopicType(topic: string, callback: (type: string) => void) {
    callback(this.session.snapshot.info?.topics.find(t => t.name === topic)?.type ?? '');
  }
  get topics() { return [...new Set(this.subscriptions.values())]; }
  get unseenTopics() { return this.topics.filter(topic => !this.latest.has(topic)); }
  private last(topic: string): ReplayMessage | undefined {
    const frames = this.frames.get(topic);
    if (!frames) return this.latest.get(topic);
    return { topic, time: this.latest.get(topic)!.time, message: { transforms: [...frames.values()] } };
  }
  private remember(item: ReplayMessage) {
    this.latest.set(item.topic, item);
    if (!isTf(item.topic)) return;
    let frames = this.frames.get(item.topic);
    if (!frames) this.frames.set(item.topic, frames = new Map());
    for (const transform of (item.message.transforms ?? []) as Transform[]) frames.set(transform.child_frame_id, transform);
  }
  deliver(item: ReplayMessage) {
    this.remember(item);
    this.session.messageTime = Number(item.time / 1000n) / 1000;
    this.emitEvent(item.topic, item.message);
  }
  /** State at a new cursor. `onlyNew` answers late subscribers without repeating others' data. */
  hydrate(items: ReplayMessage[], onlyNew: boolean) {
    if (!onlyNew) { this.latest.clear(); this.frames.clear(); }
    for (const item of items) if (!onlyNew || !this.latest.has(item.topic)) this.deliver(item);
  }
  dispose() { this.latest.clear(); this.frames.clear(); this.subscriptions.clear(); (this as unknown as Emitter).removeAllListeners(); }
}

export class ReplaySession {
  snapshot: ReplaySnapshot = { phase: 'empty', position: 0, playing: false, speed: 1, loop: false, remote: false, buffering: false };
  messageTime = 0;
  source: { ros: Ros | null; generation: number } = { ros: null, generation: 0 };
  private listeners = new Set<() => void>();
  private sourceListeners = new Set<() => void>();
  private worker?: Worker;
  private adapter?: ReplayRos;
  private requestId = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private topicTimer?: ReturnType<typeof setTimeout>;
  private bufferTimer?: ReturnType<typeof setTimeout>;
  private bag?: BagSource;
  private resumeAt = 0;
  private pendingEnd = 0;
  private lastTick = 0;
  private seeking = false;
  private refreshing = false;
  private disposed = false;
  constructor(private createWorker = () => new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' })) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  subscribeSource = (listener: () => void) => { this.sourceListeners.add(listener); return () => { this.sourceListeners.delete(listener); }; };
  getSource = () => this.source;
  get duration() { const info = this.snapshot.info; return info ? Number(info.end - info.start) / 1e9 : 0; }
  private update(patch: Partial<ReplaySnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  private sourceChanged(ros: Ros | null) { this.source = { ros, generation: this.source.generation + 1 }; this.sourceListeners.forEach(fn => fn()); }
  private post(request: ReaderRequest) { this.worker?.postMessage(request); }
  open(source: BagSource, resumeAt = 0) {
    this.close();
    if (!source.name.toLowerCase().endsWith('.mcap')) { this.update({ phase: 'error', error: 'Choose an .mcap recording.' }); return; }
    this.disposed = false;
    this.bag = source;
    this.resumeAt = resumeAt;
    this.update({ phase: 'loading', error: undefined, remote: isRemoteBag(source) });
    try {
      this.worker = this.createWorker();
      this.worker.onmessage = ({ data }: MessageEvent<ReaderResponse>) => this.receive(data);
      this.worker.onerror = event => { this.update({ phase: 'error', playing: false, error: event.message || 'The recording reader stopped unexpectedly.' }); };
      this.post({ id: ++this.requestId, op: 'open', source });
    } catch (error) { this.update({ phase: 'error', error: String(error) }); }
  }
  /** Whether a failed recording can be opened again as it was: remote reads fail with the connection. */
  get canRetry() { return this.snapshot.phase === 'error' && Boolean(this.bag && isRemoteBag(this.bag)); }
  /** Reopen a recording whose connection failed, back where it stopped. */
  retry() {
    if (!this.canRetry || !this.bag) return;
    this.open(this.bag, this.snapshot.info ? this.snapshot.position : 0);
  }
  private receive(response: ReaderResponse) {
    if (this.disposed || response.id !== this.requestId) return;
    if (response.op === 'error') { this.settled(); this.update({ phase: 'error', playing: false, error: response.error }); return; }
    if (response.op === 'opened') {
      this.adapter = new ReplayRos(this);
      this.update({ phase: 'ready', info: response.info, position: 0 });
      this.sourceChanged(this.adapter);
      this.seek(this.resumeAt, false);
    } else {
      if (this.seeking) this.adapter?.hydrate(response.messages, this.refreshing);
      else for (const item of response.messages) this.adapter?.deliver(item);
      if (!response.done) { this.worker?.postMessage({ op: 'ack', id: response.id }); return; }
      this.settled();
      this.seeking = false; this.refreshing = false;
      this.update({ phase: 'ready', position: this.pendingEnd });
      if (this.snapshot.playing) {
        if (this.snapshot.position >= this.duration) {
          if (this.snapshot.loop && this.duration > 0) this.seek(0);
          else this.pause();
        } else this.schedule();
      }
    }
  }
  refreshTopics() {
    clearTimeout(this.topicTimer);
    this.topicTimer = setTimeout(() => {
      if (!this.snapshot.info) return;
      // A pending seek was discarded, so its full state is still owed to every panel.
      this.seek(this.seeking ? this.pendingEnd : this.snapshot.position, false, !this.seeking || this.refreshing);
    }, 50);
  }
  /**
   * Moving forward keeps panel state, like live data would. Moving backward remounts consumers
   * through a new source, because TF buffers and plots cannot take messages older than they hold.
   */
  seek(position: number, reset = Math.min(this.duration, Math.max(0, position)) < this.snapshot.position, onlyNew = false) {
    if (!this.snapshot.info || !Number.isFinite(position)) return;
    clearTimeout(this.timer);
    this.settled();
    this.pendingEnd = Math.min(this.duration, Math.max(0, position));
    this.seeking = true; this.refreshing = onlyNew && !reset;
    this.update({ phase: 'seeking', position: this.pendingEnd });
    const topics = (this.refreshing ? this.adapter?.unseenTopics : this.adapter?.topics) ?? [];
    if (reset) {
      this.adapter?.dispose();
      this.adapter = new ReplayRos(this);
      this.sourceChanged(this.adapter);
    }
    this.post({ id: ++this.requestId, op: 'seek', time: this.toTime(this.pendingEnd), topics });
    this.lastTick = performance.now();
  }
  private toTime(seconds: number) { return this.snapshot.info!.start + BigInt(Math.round(seconds * 1e9)); }
  play() {
    if (!this.snapshot.info || this.snapshot.phase === 'error') return;
    this.update({ playing: true }); this.lastTick = performance.now();
    if (this.snapshot.position >= this.duration) this.seek(0);
    else if (this.snapshot.phase === 'ready') this.schedule();
  }
  pause() { clearTimeout(this.timer); this.update({ playing: false }); }
  setSpeed(speed: number) { if ([0.25, 0.5, 1, 2, 4, 8].includes(speed)) { this.update({ speed }); this.lastTick = performance.now(); } }
  setLoop(loop: boolean) { this.update({ loop }); }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.snapshot.playing || !this.snapshot.info) return;
      const now = performance.now();
      // Backpressure slows the clock instead of building an unbounded decode queue.
      const elapsed = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
      this.lastTick = now;
      this.pendingEnd = Math.min(this.duration, this.snapshot.position + elapsed * this.snapshot.speed);
      this.post({ id: ++this.requestId, op: 'read', start: this.toTime(this.snapshot.position) + 1n, end: this.toTime(this.pendingEnd), topics: this.adapter?.topics ?? [] });
      clearTimeout(this.bufferTimer);
      this.bufferTimer = setTimeout(() => this.update({ buffering: true }), 400);
    }, 33);
  }
  /** A read finished (or failed): playback is no longer waiting on it. */
  private settled() {
    clearTimeout(this.bufferTimer);
    if (this.snapshot.buffering) this.update({ buffering: false });
  }
  /**
   * Reads chosen topics over a stretch of the recording with a reader of its own, so playback and
   * the panels following it are not disturbed. `keep` decides message by message; reading stops at
   * `end`, when `keep` answers 'stop', or when the signal aborts.
   */
  readRange(
    startSec: number,
    endSec: number,
    topics: string[],
    keep: (message: ReplayMessage) => boolean | 'stop',
    signal?: AbortSignal
  ): Promise<{ complete: boolean }> {
    const info = this.snapshot.info;
    const bag = this.bag;
    if (!info || !bag) return Promise.reject(new Error('No recording is open.'));
    if (signal?.aborted) return Promise.reject(new DOMException('Reading the recording was cancelled.', 'AbortError'));
    const start = this.toTime(Math.min(this.duration, Math.max(0, startSec)));
    const end = this.toTime(Math.min(this.duration, Math.max(0, endSec)));
    return new Promise((resolve, reject) => {
      const worker = this.createWorker();
      const finish = (error?: Error, complete = true) => {
        worker.terminate();
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve({ complete });
      };
      const abort = () => finish(new DOMException('Reading the recording was cancelled.', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = event => finish(new Error(event.message || 'The recording reader stopped unexpectedly.'));
      worker.onmessage = ({ data }: MessageEvent<ReaderResponse>) => {
        if (data.op === 'error') return finish(new Error(data.error));
        if (data.op === 'opened') return worker.postMessage({ id: 2, op: 'read', start, end, topics } satisfies ReaderRequest);
        for (const item of data.messages) if (keep(item) === 'stop') return finish(undefined, false);
        if (data.done) finish();
        else worker.postMessage({ op: 'ack', id: data.id });
      };
      worker.postMessage({ id: 1, op: 'open', source: bag } satisfies ReaderRequest);
    });
  }
  close() {
    clearTimeout(this.timer); clearTimeout(this.topicTimer); clearTimeout(this.bufferTimer);
    this.worker?.terminate(); this.worker = undefined; ++this.requestId;
    this.adapter?.dispose(); this.adapter = undefined; this.seeking = false; this.refreshing = false; this.bag = undefined;
    this.update({ phase: 'empty', info: undefined, position: 0, playing: false, error: undefined, remote: false, buffering: false });
    if (this.source.ros) this.sourceChanged(null);
  }
  dispose() { this.close(); this.disposed = true; }
}
