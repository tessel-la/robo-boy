import type { RemoteBag } from './types';

/**
 * Copying a recording from the ROS host to this device.
 *
 * Where the browser can write to a file the user picks (File System Access), the download streams
 * straight to disk, so its size is bounded only by the disk. It shows progress, survives dropped
 * connections by resuming from the last byte written, and hands the finished file to Replay exactly
 * as a dropped file would. Elsewhere the browser's own download takes over.
 */
export interface DownloadSnapshot {
  name: string;
  phase: 'downloading' | 'retrying' | 'done' | 'error';
  loaded: number;
  total: number;
  /** Bytes per second over the last few seconds. */
  rate: number;
  error?: string;
}

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
interface Writable { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }

export const canSaveToDisk = () => typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

/**
 * Ask where to save. Must be called straight from the click, before any await. Resolves to null
 * when the user closes the dialog.
 */
export async function chooseSaveTarget(name: string): Promise<FileSystemFileHandle | null> {
  try {
    return await ((globalThis as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker)({
      suggestedName: name, types: [{ description: 'MCAP recording', accept: { 'application/octet-stream': ['.mcap'] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

/**
 * Let the browser download it; the file service's Content-Disposition names the file.
 *
 * Not through a link: a link to another origin navigates this page, and Firefox closes the page's
 * WebSockets -- the robot connection -- when a navigation turns into a download. A hidden frame
 * navigates instead, and the download manager takes it from there.
 */
export function downloadWithBrowser(url: string) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = url;
  document.body.append(frame);
  setTimeout(() => frame.remove(), 60_000);
}

/** A failure resuming cannot fix: the file changed or is gone, or this device cannot store it. */
class FatalError extends Error {}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class RecordingDownload {
  snapshot: DownloadSnapshot;
  private writable?: Writable;
  private controller = new AbortController();
  private etag?: string;
  private samples: { time: number; loaded: number }[] = [];
  private lastEmit = 0;
  private running = false;

  constructor(
    private bag: RemoteBag,
    private handle: FileSystemFileHandle,
    private onChange: (snapshot: DownloadSnapshot) => void,
    private options: { fetch?: typeof fetch; retryDelays?: number[]; idleTimeout?: number } = {},
  ) {
    this.snapshot = { name: bag.name, phase: 'downloading', loaded: 0, total: bag.size, rate: 0 };
  }

  private update(patch: Partial<DownloadSnapshot>, force = true) {
    const now = performance.now();
    this.snapshot = { ...this.snapshot, ...patch };
    if (!force && now - this.lastEmit < 250) return;
    this.lastEmit = now;
    this.onChange(this.snapshot);
  }

  /** Start, or continue after an error from the last byte written. */
  async run() {
    if (this.running || this.snapshot.phase === 'done') return;
    this.running = true;
    const delays = this.options.retryDelays ?? [1000, 2000, 5000, 10000];
    try {
      this.writable ??= await (this.handle as unknown as { createWritable(): Promise<Writable> }).createWritable();
      this.update({ phase: 'downloading', error: undefined });
      for (let attempt = 0; ; attempt++) {
        try {
          await this.transfer();
          if (this.controller.signal.aborted || !this.writable) return;
          await this.writable.close();
          this.writable = undefined;
          this.update({ phase: 'done', rate: 0 });
          return;
        } catch (error) {
          if (this.controller.signal.aborted) return;
          if (error instanceof FatalError || attempt >= delays.length) throw error;
          this.update({ phase: 'retrying', rate: 0, error: `Connection lost. Retrying from ${Math.floor(this.snapshot.loaded / this.bag.size * 100)}%…` });
          await sleep(delays[attempt], this.controller.signal);
          if (this.controller.signal.aborted) return;
          this.update({ phase: 'downloading', error: undefined });
        }
      }
    } catch (error) {
      if (error instanceof FatalError) await this.discard();
      this.update({ phase: 'error', rate: 0, error: error instanceof FatalError ? error.message : `The download stopped at ${Math.floor(this.snapshot.loaded / this.bag.size * 100)}%: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      this.running = false;
    }
  }

  get canResume() { return this.snapshot.phase === 'error' && this.writable !== undefined; }

  /** Stop and throw away the partial file. */
  async cancel() {
    this.controller.abort();
    await this.discard();
  }

  /** The finished file, to open in Replay like a dropped one. */
  file() { return this.handle.getFile(); }

  private async discard() {
    const writable = this.writable;
    this.writable = undefined;
    await writable?.abort().catch(() => undefined);
  }

  private async transfer() {
    const from = this.snapshot.loaded;
    const request = new AbortController();
    const cancel = () => request.abort();
    this.controller.signal.addEventListener('abort', cancel, { once: true });
    let idle: ReturnType<typeof setTimeout> | undefined;
    const wait = () => { clearTimeout(idle); idle = setTimeout(() => request.abort(), this.options.idleTimeout ?? 30_000); };
    wait();
    try {
      const response = await (this.options.fetch ?? fetch)(this.bag.url, { cache: 'no-store', signal: request.signal, headers: from ? { Range: `bytes=${from}-` } : {} });
      const changed = new FatalError('The recording changed on the ROS host while it was downloading. Download it again.');
      if (response.status === 404) throw new FatalError('The recording is no longer on the ROS host.');
      if (response.status === 409) throw new FatalError('This recording is still being written on the ROS host. Stop it before downloading it.');
      if (response.status === 416) throw changed;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const etag = response.headers.get('ETag') ?? undefined;
      const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      const expected = from ? response.status === 206 && Number(range?.[1]) === from && Number(range?.[2]) === this.bag.size : response.status === 200 || response.status === 206;
      if (!expected || (this.etag && etag && etag !== this.etag)) throw changed;
      this.etag ??= etag;
      const reader = response.body!.getReader();
      for (;;) {
        wait();
        const { done, value } = await reader.read();
        if (done) break;
        await this.writable!.write(value).catch((error: unknown) => {
          throw new FatalError(`This device could not save the file: ${error instanceof Error ? error.message : String(error)}`);
        });
        this.progress(this.snapshot.loaded + value.length);
      }
      if (this.snapshot.loaded !== this.bag.size) throw new Error('the connection closed early');
    } catch (error) {
      if (request.signal.aborted && !this.controller.signal.aborted) throw new Error('no data for too long');
      throw error;
    } finally {
      clearTimeout(idle);
      this.controller.signal.removeEventListener('abort', cancel);
    }
  }

  private progress(loaded: number) {
    const now = performance.now();
    this.samples.push({ time: now, loaded });
    while (this.samples.length > 2 && now - this.samples[0].time > 3000) this.samples.shift();
    const first = this.samples[0];
    const rate = now > first.time ? ((loaded - first.loaded) / (now - first.time)) * 1000 : 0;
    this.update({ loaded, rate }, loaded === this.bag.size);
  }
}
