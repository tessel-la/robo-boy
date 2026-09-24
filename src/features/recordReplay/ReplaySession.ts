import ROSLIB, { type Ros } from 'roslib';
import type { BagInfo, ReaderRequest, ReaderResponse, ReplayMessage } from './types';

type WireMessage = { op: string; id?: string; topic?: string; service?: string; args?: { topic?: string; type?: string } };
type Emitter = { emit: (name: string, value: unknown) => void; removeAllListeners: () => void };
export interface ReplaySnapshot {
  phase: 'empty' | 'loading' | 'ready' | 'seeking' | 'error';
  info?: BagInfo;
  position: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  error?: string;
}
const replaySources = new WeakMap<Ros, ReplaySession>();
export const getReplaySession = (ros: Ros | null) => ros ? replaySources.get(ros) : undefined;

/** A ROSLIB-compatible read adapter with no socket and no publishing path. */
class ReplayRos extends ROSLIB.Ros {
  private subscriptions = new Map<string, string>();
  private latest = new Map<string, ReplayMessage>();
  private cacheBytes = 0;
  constructor(private session: ReplaySession) {
    super({ url: '' });
    this.isConnected = true;
    replaySources.set(this, session);
  }
  emitEvent(name: string, value: unknown) { (this as unknown as Emitter).emit(name, value); }
  callOnConnection = (message: WireMessage) => {
    if (message.op === 'subscribe' && message.topic && message.id) {
      this.subscriptions.set(message.id, message.topic);
      const last = this.latest.get(message.topic);
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
  deliver(item: ReplayMessage) {
    this.session.messageTime = Number(item.time / 1000n) / 1000;
    this.emitEvent(item.topic, item.message);
  }
  hydrate(items: ReplayMessage[]) {
    // Only seek state is cached; streaming payloads are released immediately.
    this.latest.clear(); this.cacheBytes = 0;
    for (const item of items) {
      this.cacheBytes += 1;
      if (this.cacheBytes <= 512) this.latest.set(item.topic, item);
      this.deliver(item);
    }
  }
  reset() { this.latest.clear(); this.emitEvent('replay-reset', undefined); }
  dispose() { this.latest.clear(); this.subscriptions.clear(); (this as unknown as Emitter).removeAllListeners(); }
}

export class ReplaySession {
  snapshot: ReplaySnapshot = { phase: 'empty', position: 0, playing: false, speed: 1, loop: false };
  messageTime = 0;
  source: { ros: Ros | null; generation: number } = { ros: null, generation: 0 };
  private listeners = new Set<() => void>();
  private sourceListeners = new Set<() => void>();
  private worker?: Worker;
  private adapter?: ReplayRos;
  private requestId = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private topicTimer?: ReturnType<typeof setTimeout>;
  private pendingEnd = 0;
  private lastTick = 0;
  private seeking = false;
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
  open(file: File) {
    this.close();
    if (!file.name.toLowerCase().endsWith('.mcap')) { this.update({ phase: 'error', error: 'Choose an .mcap recording.' }); return; }
    this.disposed = false;
    this.update({ phase: 'loading', error: undefined });
    try {
      this.worker = this.createWorker();
      this.worker.onmessage = ({ data }: MessageEvent<ReaderResponse>) => this.receive(data);
      this.worker.onerror = event => { this.update({ phase: 'error', playing: false, error: event.message || 'The recording reader stopped unexpectedly.' }); };
      this.post({ id: ++this.requestId, op: 'open', file });
    } catch (error) { this.update({ phase: 'error', error: String(error) }); }
  }
  private receive(response: ReaderResponse) {
    if (this.disposed || response.id !== this.requestId) return;
    if (response.op === 'error') { this.update({ phase: 'error', playing: false, error: response.error }); return; }
    if (response.op === 'opened') {
      this.adapter = new ReplayRos(this);
      this.update({ phase: 'ready', info: response.info, position: 0 });
      this.sourceChanged(this.adapter);
      this.seek(0, false);
    } else {
      if (this.seeking) this.adapter?.hydrate(response.messages);
      else for (const item of response.messages) this.adapter?.deliver(item);
      if (!response.done) { this.worker?.postMessage({ op: 'ack', id: response.id }); return; }
      this.seeking = false;
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
    this.topicTimer = setTimeout(() => { if (this.snapshot.info) this.seek(this.snapshot.position, false); }, 50);
  }
  seek(position: number, reset = true) {
    if (!this.snapshot.info || !Number.isFinite(position)) return;
    clearTimeout(this.timer);
    this.pendingEnd = Math.min(this.duration, Math.max(0, position));
    this.seeking = true;
    this.update({ phase: 'seeking', position: this.pendingEnd });
    const topics = this.adapter?.topics ?? [];
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
    }, 33);
  }
  close() {
    clearTimeout(this.timer); clearTimeout(this.topicTimer);
    this.worker?.terminate(); this.worker = undefined; ++this.requestId;
    this.adapter?.dispose(); this.adapter = undefined; this.seeking = false;
    this.update({ phase: 'empty', info: undefined, position: 0, playing: false, error: undefined });
    if (this.source.ros) this.sourceChanged(null);
  }
  dispose() { this.close(); this.disposed = true; }
}
