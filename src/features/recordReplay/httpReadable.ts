/**
 * Random access to a recording on the ROS host over HTTP range requests, shaped like the MCAP
 * reader's IReadable. Replaying a bag in place then transfers only its summary and the chunks being
 * played, never the whole file.
 *
 * Each read asks for exactly the bytes the reader wants: opening a bag touches a few small, scattered
 * records, and rounding those up would move megabytes for nothing. Playback is different -- it walks
 * the chunks in file order -- so once reads run sequentially the next stretch of the file is fetched
 * ahead in the background, and a high-latency link (a VPN, a robot's Wi-Fi) is not one round trip per
 * chunk. Fetched stretches stay in a small byte-bounded cache.
 */
export interface RangeReadable {
  size(): Promise<bigint>;
  read(offset: bigint, size: bigint): Promise<Uint8Array>;
}

export interface HttpReadableOptions {
  fetch?: typeof fetch;
  /** Bytes fetched ahead of sequential reads; 0 turns read-ahead off. */
  readAhead?: number;
  /** A read that starts at most this far past the previous one still counts as sequential. */
  sequentialGap?: number;
  cacheBytes?: number;
  /** Delays between attempts; one more attempt than delays is made. */
  retryDelays?: number[];
  /** Give up on a response that delivers nothing for this long. */
  idleTimeout?: number;
}

/** A failure retrying will not fix: the file is gone, changed, or the server cannot serve ranges. */
class PermanentError extends Error {}

interface Span { start: number; end: number; data: Promise<Uint8Array> }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class HttpReadable implements RangeReadable {
  private spans: Span[] = [];
  private lastEnd = -1;
  private etag?: string;
  private readonly fetch: typeof fetch;
  private readonly readAhead: number;
  private readonly sequentialGap: number;
  private readonly cacheBytes: number;
  private readonly retryDelays: number[];
  private readonly idleTimeout: number;

  constructor(private url: string, private length: number, options: HttpReadableOptions = {}) {
    this.fetch = options.fetch ?? ((...args) => fetch(...args));
    this.readAhead = options.readAhead ?? 8 * 1024 * 1024;
    this.sequentialGap = options.sequentialGap ?? 1024 * 1024;
    this.cacheBytes = options.cacheBytes ?? 64 * 1024 * 1024;
    this.retryDelays = options.retryDelays ?? [500, 1500, 4000];
    this.idleTimeout = options.idleTimeout ?? 20_000;
  }

  async size() { return BigInt(this.length); }

  async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    const start = Number(offset), end = start + Number(size);
    if (start < 0 || end > this.length) throw new Error(`Read past the end of the recording (${end} of ${this.length} bytes).`);
    if (start === end) return new Uint8Array();
    const sequential = this.lastEnd >= 0 && start >= this.lastEnd && start - this.lastEnd <= this.sequentialGap;
    this.lastEnd = end;
    const parts = this.cover(start, end);
    if (sequential) this.fetchAhead(end);
    const data = await Promise.all(parts.map(part => part.data));
    if (parts.length === 1) return data[0].subarray(start - parts[0].start, end - parts[0].start);
    const result = new Uint8Array(end - start);
    parts.forEach((part, index) => {
      const from = Math.max(start, part.start), to = Math.min(end, part.end);
      result.set(data[index].subarray(from - part.start, to - part.start), from - start);
    });
    return result;
  }

  /** Spans that hold [start, end) back to back, fetching whatever the cache does not already hold. */
  private cover(start: number, end: number): Span[] {
    const parts: Span[] = [];
    for (let position = start; position < end;) {
      const span = this.spans.find(candidate => candidate.start <= position && position < candidate.end) ?? this.fetchSpan(position, end);
      parts.push(span);
      position = span.end;
    }
    return parts;
  }

  /** Keep at least half a read-ahead of the file in memory or in flight past `position`. */
  private fetchAhead(position: number) {
    if (!this.readAhead) return;
    let frontier = position;
    for (let covering; (covering = this.spans.find(span => span.start <= frontier && frontier < span.end));) frontier = covering.end;
    if (frontier - position >= this.readAhead / 2 || frontier >= this.length) return;
    this.fetchSpan(frontier, Math.min(this.length, frontier + this.readAhead));
  }

  private fetchSpan(start: number, end: number): Span {
    const span: Span = { start, end, data: this.fetchRange(start, end) };
    // A failed span is forgotten so the next read asks again; read-ahead failures stay silent.
    span.data.catch(() => { this.spans = this.spans.filter(candidate => candidate !== span); });
    this.spans.push(span);
    let total = this.spans.reduce((sum, candidate) => sum + candidate.end - candidate.start, 0);
    while (total > this.cacheBytes && this.spans.length > 1) {
      const evicted = this.spans.shift()!;
      total -= evicted.end - evicted.start;
    }
    return span;
  }

  /** Bytes [from, to), retried with backoff when the connection fails rather than the file. */
  private async fetchRange(from: number, to: number): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchOnce(from, to);
      } catch (error) {
        if (error instanceof PermanentError) throw error;
        if (attempt >= this.retryDelays.length) {
          throw new Error(`Lost the connection to the ROS host while reading the recording (${error instanceof Error ? error.message : String(error)}).`);
        }
        await sleep(this.retryDelays[attempt]);
      }
    }
  }

  private async fetchOnce(from: number, to: number): Promise<Uint8Array> {
    const controller = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const wait = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), this.idleTimeout); };
    wait();
    try {
      const response = await this.fetch(this.url, { headers: { Range: `bytes=${from}-${to - 1}` }, cache: 'no-store', signal: controller.signal });
      if (response.status === 404) throw new PermanentError('The recording is no longer on the ROS host.');
      if (response.status === 409) throw new PermanentError('This recording is still being written on the ROS host. Stop it before replaying it.');
      if (response.status === 416) throw new PermanentError('The recording changed on the ROS host. Open it again.');
      if (response.status === 200) throw new PermanentError('The ROS host sent the whole file instead of a part of it, so this recording cannot be replayed in place. Download it instead.');
      if (response.status !== 206) throw new Error(`HTTP ${response.status}`);
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      if (!range || Number(range[1]) !== from || Number(range[2]) !== to - 1) throw new Error('unexpected response range');
      const etag = response.headers.get('ETag') ?? undefined;
      if (Number(range[3]) !== this.length || (this.etag && etag && etag !== this.etag)) throw new PermanentError('The recording changed on the ROS host. Open it again.');
      this.etag ??= etag;
      const bytes = new Uint8Array(to - from);
      let received = 0;
      const reader = response.body!.getReader();
      for (;;) {
        wait();
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > bytes.length) throw new Error('response longer than requested');
        bytes.set(value, received);
        received += value.length;
      }
      if (received !== bytes.length) throw new Error('the response ended early');
      return bytes;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('no data for too long');
      throw error;
    } finally {
      clearTimeout(idle);
    }
  }
}
