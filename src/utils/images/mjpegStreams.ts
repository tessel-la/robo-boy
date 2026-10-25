import type { Ros } from 'roslib';
import { enterpriseFetch } from '../../features/enterprise/session';
import { getSafeCameraStreamUrl } from '../cameraStreamUrl';
import { decodeImageFrame } from './decodeImage';
import { jpegMetadata } from './jpegMetadata';
import { MjpegParser } from './mjpegParser';
import { shareImageFrame, type ImageEvent } from './sharedImageFrame';

const streams = new WeakMap<Ros, Map<string, MjpegStream>>();
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Camera stream failed.');

class MjpegStream {
  readonly listeners = new Set<(event: ImageEvent) => void>();
  event: ImageEvent = { frame: null, error: null };
  private abort?: AbortController;
  private releaseFrame?: () => void;
  private pending?: Uint8Array;
  private scheduled = 0;
  private busy = false;
  private disposed = false;
  private generation = 0;
  private refresh: string | null;
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private url: string) {
    this.refresh = new URL(url, location.href).searchParams.get('_refresh');
    this.start();
  }
  refreshFrom(url: string) {
    const token = new URL(url, location.href).searchParams.get('_refresh');
    if (!token || token === this.refresh) return;
    this.url = url;
    this.refresh = token;
    this.abort?.abort();
    this.pending = undefined;
    this.start();
  }
  private emit(event: ImageEvent) {
    this.event = event;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Camera consumer failed:', error);
      }
    }
  }
  private armIdle(generation: number) {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.disposed || generation !== this.generation) return;
      ++this.generation;
      this.abort?.abort();
      this.pending = undefined;
      this.emit({ frame: null, error: 'Camera stream timed out. Refresh to reconnect.' });
      this.releaseFrame?.();
      this.releaseFrame = undefined;
    }, 10000);
  }
  private start() {
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.armIdle(generation);
    void (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await enterpriseFetch(this.url, {
          signal: abort.signal,
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`Camera stream returned HTTP ${response.status}.`);
        if (!response.body) throw new Error('This browser cannot read camera streams.');
        const parser = new MjpegParser(response.headers.get('content-type') ?? '', bytes => {
          this.armIdle(generation);
          this.pending = bytes;
          this.schedule();
        });
        reader = response.body.getReader();
        while (!this.disposed && generation === this.generation) {
          const { done, value } = await reader.read();
          if (this.disposed || generation !== this.generation) return;
          if (done) throw new Error('Camera stream ended. Refresh to reconnect.');
          parser.push(value);
        }
      } catch (error) {
        if (!this.disposed && generation === this.generation && !abort.signal.aborted) {
          this.pending = undefined;
          clearTimeout(this.idleTimer);
          this.emit({ frame: null, error: errorMessage(error) });
          this.releaseFrame?.();
          this.releaseFrame = undefined;
          // Also invalidates an in-flight decode so it cannot resurrect a failed stream.
          ++this.generation;
        }
      } finally {
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
    })();
  }
  private schedule() {
    if (this.disposed || this.busy || this.scheduled || !this.pending) return;
    this.scheduled = requestAnimationFrame(() => void this.decode());
  }
  private async decode() {
    this.scheduled = 0;
    const bytes = this.pending;
    this.pending = undefined;
    if (!bytes || this.disposed) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const metadata = jpegMetadata(bytes);
      const decoded = await decodeImageFrame({ format: 'jpeg', data: bytes }, 'sensor_msgs/CompressedImage');
      if (this.disposed || generation !== this.generation) {
        decoded.image && 'close' in decoded.image && decoded.image.close();
        return;
      }
      const previous = this.releaseFrame;
      const shared = shareImageFrame({ ...decoded, ...metadata });
      this.releaseFrame = shared.release;
      this.emit({ frame: shared.frame, error: null });
      previous?.();
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.emit({ frame: null, error: errorMessage(error) });
        this.releaseFrame?.();
        this.releaseFrame = undefined;
      }
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.abort?.abort();
    clearTimeout(this.idleTimer);
    cancelAnimationFrame(this.scheduled);
    this.pending = undefined;
    this.releaseFrame?.();
    this.releaseFrame = undefined;
    this.event = { frame: null, error: null };
  }
}

/** One full-rate reader/decoder per connection and compatible stream profile; no projection throttling here. */
export function subscribeToMjpeg(ros: Ros, url: string, baseUrl: string, listener: (event: ImageEvent) => void) {
  const safe = getSafeCameraStreamUrl(url, baseUrl);
  if (!safe) throw new Error('Camera stream URL is invalid.');
  const canonical = new URL(safe, location.href);
  canonical.searchParams.delete('_refresh');
  canonical.searchParams.sort();
  const key = canonical.href;
  let sources = streams.get(ros);
  if (!sources) streams.set(ros, (sources = new Map()));
  let stream = sources.get(key);
  if (!stream) sources.set(key, (stream = new MjpegStream(safe)));
  else stream.refreshFrom(safe);
  stream.listeners.add(listener);
  listener(stream.event);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    stream!.listeners.delete(listener);
    if (!stream!.listeners.size) {
      stream!.dispose();
      sources!.delete(key);
    }
  };
}
