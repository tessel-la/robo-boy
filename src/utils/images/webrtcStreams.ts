import type { Ros } from 'roslib';
import { enterpriseFetch } from '../../features/enterprise/session';
import { checkImageDimensions } from './imageFrames';
import { shareImageFrame, type ImageEvent, type SharedImageFrame } from './sharedImageFrame';

export interface WebRtcOptions {
  whepUrl?: string;
}
export type VideoEvent = { stream: MediaStream | null; error: string | null };
const sessions = new WeakMap<Ros, Map<string, WebRtcSession>>();
const message = (error: unknown) => (error instanceof Error ? error.message : 'WebRTC connection failed.');

export function validateWhepUrl(value: string): string {
  const url = new URL(value, location.href);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('WHEP URL must use HTTP(S), without embedded credentials or a fragment.');
  return url.href;
}

// WHEP OPTIONS Link headers carry optional STUN/TURN configuration. Credentials stay in this session.
function iceServers(header: string | null): RTCIceServer[] {
  if (!header || header.length > 8192) return [];
  const result: RTCIceServer[] = [];
  for (const match of header.matchAll(/<((?:stun|stuns|turn|turns):[^>]+)>\s*([^,]*)/gi)) {
    const params = match[2];
    if (!/rel\s*=\s*"?ice-server/i.test(params)) continue;
    const field = (name: string) => new RegExp(`${name}="([^"]*)"`, 'i').exec(params)?.[1];
    result.push({ urls: match[1], username: field('username'), credential: field('credential') });
  }
  return result.slice(0, 8);
}
export async function readSignalingText(response: Response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let size = 0,
    result = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return result + decoder.decode();
      if ((size += value.length) > 256 * 1024) throw new Error('WebRTC signaling response exceeds its limit.');
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class WebRtcSession {
  videos = new Set<(event: VideoEvent) => void>();
  frames = new Map<(event: ImageEvent) => void, number>();
  event: VideoEvent = { stream: null, error: null };
  private peer?: RTCPeerConnection;
  private abort = new AbortController();
  private sessionUrl?: string;
  private closed = false;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private connecting: Promise<void>;
  private restarting = false;
  private video?: HTMLVideoElement;
  private callback = 0;
  private busy = false;
  private sampled = -Infinity;
  private captureError: string | null = null;
  private current?: { frame: SharedImageFrame; release: () => void };
  constructor(private endpoint: string) {
    this.connecting = this.connect();
  }
  retryIfFailed() {
    if (!this.closed || !this.event.error || this.restarting) return;
    this.restarting = true;
    void this.connecting.finally(() => {
      this.restarting = false;
      if (!this.videos.size && !this.frames.size) return;
      this.closed = false;
      this.abort = new AbortController();
      this.captureError = null;
      this.event = { stream: null, error: null };
      this.notify();
      this.connecting = this.connect();
    });
  }
  private emit<T>(listener: (value: T) => void, value: T) {
    try {
      listener(value);
    } catch (error) {
      console.error('Camera consumer failed:', error);
    }
  }
  private notify() {
    for (const listener of this.videos) this.emit(listener, this.event);
  }
  private fail(error: unknown) {
    if (this.closed) return;
    this.dispose();
    this.event = { stream: null, error: message(error) };
    this.notify();
    for (const listener of this.frames.keys()) this.emit(listener, { frame: null, error: this.event.error });
  }
  private async connect() {
    this.connectTimer = setTimeout(() => this.fail(new Error('WebRTC connection timed out. Refresh to retry.')), 15000);
    try {
      if (typeof RTCPeerConnection === 'undefined')
        throw new Error('WebRTC is unavailable in this browser. Choose another image source.');
      let servers: RTCIceServer[] = [];
      try {
        const options = await enterpriseFetch(this.endpoint, {
          method: 'OPTIONS',
          signal: this.abort.signal,
          redirect: 'error',
          credentials: 'omit',
        });
        if (options.ok) servers = iceServers(options.headers.get('Link'));
      } catch {
        if (this.abort.signal.aborted) throw new Error('WebRTC connection timed out.');
      }
      if (this.closed) return;
      const peer = new RTCPeerConnection({ iceServers: servers });
      this.peer = peer;
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.ontrack = event => {
        if (this.closed || event.track.kind !== 'video') return;
        this.event = { stream: event.streams[0] ?? new MediaStream([event.track]), error: null };
        this.notify();
        this.startFrames();
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') clearTimeout(this.connectTimer);
        if (peer.connectionState === 'failed') this.fail(new Error('WebRTC connection failed. Refresh to retry.'));
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (this.closed) return;
      if (peer.iceGatheringState !== 'complete')
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            peer.removeEventListener('icegatheringstatechange', changed);
            this.abort.signal.removeEventListener('abort', aborted);
          };
          const changed = () => {
            if (peer.iceGatheringState === 'complete') {
              finish();
              resolve();
            }
          };
          const aborted = () => {
            finish();
            reject(new Error('WebRTC connection timed out.'));
          };
          peer.addEventListener('icegatheringstatechange', changed);
          this.abort.signal.addEventListener('abort', aborted, { once: true });
          if (this.abort.signal.aborted) aborted();
          else changed();
        });
      if (this.closed) return;
      const response = await enterpriseFetch(this.endpoint, {
        method: 'POST',
        signal: this.abort.signal,
        redirect: 'error',
        credentials: 'omit',
        headers: { Accept: 'application/sdp', 'Content-Type': 'application/sdp' },
        body: peer.localDescription?.sdp,
      });
      if (response.status !== 201) throw new Error(`WHEP negotiation returned HTTP ${response.status}.`);
      const location = response.headers.get('Location');
      if (!location) throw new Error('WHEP response has no session Location.');
      const session = new URL(location, this.endpoint),
        endpoint = new URL(this.endpoint);
      const prefix = endpoint.pathname.slice(0, endpoint.pathname.lastIndexOf('/') + 1);
      if (
        session.origin !== endpoint.origin ||
        !session.pathname.startsWith(prefix) ||
        session.username ||
        session.password ||
        session.hash
      )
        throw new Error('WHEP session Location is outside the selected stream.');
      this.sessionUrl = session.href;
      if (this.closed) {
        void this.deleteSession();
        return;
      }
      const sdp = await readSignalingText(response);
      if (!sdp.trim()) throw new Error('WHEP returned an empty SDP answer.');
      if (this.closed) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      this.fail(error);
      this.peer?.close();
      void this.deleteSession();
    }
  }
  syncFrames() {
    if (this.closed) return;
    if (this.frames.size) {
      if (this.captureError)
        for (const listener of this.frames.keys()) this.emit(listener, { frame: null, error: this.captureError });
      else this.startFrames();
    } else {
      this.stopFrames();
      this.captureError = null;
    }
  }
  private deliver() {
    if (!this.current) return;
    for (const listener of this.frames.keys()) this.emit(listener, { frame: this.current.frame, error: null });
  }
  private failFrames(error: unknown) {
    this.stopFrames();
    this.captureError = message(error);
    for (const listener of this.frames.keys()) this.emit(listener, { frame: null, error: this.captureError });
  }
  private startFrames() {
    if (this.closed || !this.frames.size || !this.event.stream || this.video || this.captureError) return;
    const video = document.createElement('video');
    this.video = video;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.event.stream;
    if (typeof video.requestVideoFrameCallback !== 'function' || typeof createImageBitmap !== 'function') {
      this.failFrames(new Error('This browser cannot capture WebRTC frames for 3D.'));
      return;
    }
    const receive: VideoFrameRequestCallback = now => {
      if (this.closed || this.video !== video) return;
      this.callback = video.requestVideoFrameCallback(receive);
      const rates = [...this.frames.values()];
      const fps = rates.includes(0) ? 0 : Math.max(...rates);
      if (this.busy || (fps && now - this.sampled < 1000 / fps)) return;
      this.sampled = now;
      try {
        checkImageDimensions(video.videoWidth, video.videoHeight);
      } catch (error) {
        this.failFrames(error);
        return;
      }
      this.busy = true;
      void createImageBitmap(video)
        .then(image => {
          if (this.closed || this.video !== video) {
            image.close();
            return;
          }
          const previous = this.current;
          const shared = shareImageFrame({ image, encoding: 'webrtc' });
          this.current = shared;
          this.deliver();
          previous?.release();
        })
        .catch(error => this.failFrames(error))
        .finally(() => {
          this.busy = false;
        });
    };
    this.callback = video.requestVideoFrameCallback(receive);
    void video.play().catch(error => this.failFrames(error));
  }
  private stopFrames() {
    this.video?.cancelVideoFrameCallback?.(this.callback);
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = undefined;
    this.current?.release();
    this.current = undefined;
  }
  private async deleteSession() {
    const url = this.sessionUrl;
    this.sessionUrl = undefined;
    if (url)
      await enterpriseFetch(url, {
        method: 'DELETE',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.connectTimer);
    this.abort.abort();
    this.peer?.close();
    this.stopFrames();
    void this.deleteSession();
  }
}

function acquire(ros: Ros, endpoint: string) {
  const url = validateWhepUrl(endpoint);
  let sources = sessions.get(ros);
  if (!sources) sessions.set(ros, (sources = new Map()));
  let session = sources.get(url);
  if (!session) sources.set(url, (session = new WebRtcSession(url)));
  session.retryIfFailed();
  const release = () => {
    if (!session!.videos.size && !session!.frames.size) {
      session!.dispose();
      if (sources!.get(url) === session) sources!.delete(url);
    }
  };
  return { session, release };
}
export function subscribeToWebRtcVideo(ros: Ros, endpoint: string, listener: (event: VideoEvent) => void) {
  const { session, release } = acquire(ros, endpoint);
  session.videos.add(listener);
  listener(session.event);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    session.videos.delete(listener);
    release();
  };
}
export function subscribeToWebRtcFrames(
  ros: Ros,
  endpoint: string,
  listener: (event: ImageEvent) => void,
  maxFps = 10
) {
  const { session, release } = acquire(ros, endpoint);
  session.frames.set(listener, Number.isFinite(maxFps) ? Math.min(60, Math.max(0, maxFps)) : 10);
  session.syncFrames();
  if (session.event.error) listener({ frame: null, error: session.event.error });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    session.frames.delete(listener);
    session.syncFrames();
    release();
  };
}
