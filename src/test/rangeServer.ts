import { vi } from 'vitest';

/** How the next request goes wrong: a dropped connection, an HTTP status, a truncated body, or a body that stalls. */
export type Failure = 'network' | number | 'short' | 'stall';

/**
 * A `fetch` serving one file the way the recorder's file service does: Range, Content-Range and a
 * strong ETag. Failures are consumed one per request, in order.
 */
export function rangeServer(bytes: Uint8Array, options: { etag?: () => string; failures?: Failure[]; ranges?: boolean; size?: number } = {}) {
  const failures = [...(options.failures ?? [])];
  const requests: { url: string; range?: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range') ?? undefined;
    requests.push({ url: String(input), range });
    const failure = failures.shift();
    if (failure === 'network') throw new TypeError('Failed to fetch');
    if (typeof failure === 'number') return new Response(JSON.stringify({ error: `status ${failure}` }), { status: failure });
    const headers: Record<string, string> = { ETag: options.etag?.() ?? '"v1"', 'Accept-Ranges': 'bytes' };
    const match = options.ranges === false ? null : /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (match) headers['Content-Range'] = `bytes ${start}-${end}/${options.size ?? bytes.length}`;
    let body: BodyInit = bytes.slice(start, end + 1);
    if (failure === 'short') body = bytes.slice(start, start + Math.floor((end - start + 1) / 2));
    if (failure === 'stall') {
      body = new ReadableStream({
        start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError'))); },
      });
    }
    return new Response(body, { status: match ? 206 : 200, headers });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}
