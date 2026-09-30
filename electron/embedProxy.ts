import { ipcMain, net } from 'electron';
import { EMBED_PORT_PATH, embedHostFor, isEmbedHost, normalizeEmbedBaseUrl } from '../src/runtime/embedTarget';

/**
 * Forwards a connection's embed host to the robot proxy it stands for.
 *
 * A panel frames `/<port>/` beside its sandbox. In a browser that path is served by the robot's
 * own Robo-Boy proxy, which publishes the ports its deployment allows; here the sandbox sits on
 * `app://embed-<id>/` and this forwards the same path to that proxy, so the robot's allowlist
 * decides exactly as it does for a browser. Hosts nobody registered reach nothing.
 */

export { isEmbedHost };

const targets = new Map<string, string>();

/** Records a robot proxy the renderer is about to frame, returning its host or null if refused. */
export const addEmbedTarget = (value: unknown): string | null => {
  const baseUrl = typeof value === 'string' ? normalizeEmbedBaseUrl(value) : null;
  if (!baseUrl) return null;
  const host = embedHostFor(baseUrl);
  targets.set(host, baseUrl);
  return host;
};

// The shell's network stack negotiates and decodes compression itself, sets its own framing, and
// cookies for the robot would belong to the operator's session rather than to the framed page.
const DROPPED_REQUEST_HEADERS = [
  'host',
  'origin',
  'referer',
  'cookie',
  'accept-encoding',
  'connection',
  'content-length',
  'transfer-encoding',
];
// The body arrives decoded, so the upstream's encoding and length no longer describe it.
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'];
const BODILESS_STATUSES = new Set([101, 103, 204, 205, 304]);

const notFound = (message: string) =>
  new Response(message, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const toHeaders = (record: Record<string, string | string[]>): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(record)) {
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
};

interface UpstreamReply {
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * One request to the robot proxy, with redirects handed back rather than followed.
 *
 * `net.fetch` cannot do this: under `redirect: 'manual'` it rejects with "Redirect was cancelled"
 * instead of returning the 3xx. Following them here is no answer either, because the frame would
 * keep the old URL and resolve the page's relative paths against it -- a trailing-slash redirect
 * would break every asset on the page.
 */
const requestUpstream = (
  target: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined,
  signal: AbortSignal
): Promise<UpstreamReply> =>
  new Promise((resolve, reject) => {
    const upstream = net.request({ url: target, method, redirect: 'manual', credentials: 'omit' });
    headers.forEach((value, name) => upstream.setHeader(name, value));
    const abort = () => upstream.abort();
    signal.addEventListener('abort', abort, { once: true });

    upstream.on('redirect', (status, _method, redirectUrl, responseHeaders) => {
      upstream.abort();
      const redirectHeaders = toHeaders(responseHeaders);
      redirectHeaders.set('location', redirectUrl);
      resolve({ status, statusText: '', headers: redirectHeaders, body: null });
    });
    upstream.on('response', message => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          message.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
          message.on('end', () => {
            signal.removeEventListener('abort', abort);
            controller.close();
          });
          message.on('error', (error: Error) => controller.error(error));
        },
        cancel: abort,
      });
      resolve({
        status: message.statusCode,
        statusText: message.statusMessage,
        headers: toHeaders(message.headers),
        body: stream,
      });
    });
    upstream.on('error', reject);
    upstream.end(body ? Buffer.from(body) : undefined);
  });

/**
 * Answers a request on an embed host: the sandbox document itself, or a `/<port>/` path on the
 * robot. The sandbox is served here too, because its CSP only frames its own origin.
 */
export async function fetchEmbed(
  request: Request,
  serveSandbox: () => Promise<Response>
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/panel-sandbox.html') return serveSandbox();

  const baseUrl = targets.get(url.hostname);
  if (!baseUrl) return notFound('No robot is registered for this embed host.');
  if (!EMBED_PORT_PATH.test(url.pathname)) return notFound('Only /<port>/ paths are forwarded to the robot.');

  const headers = new Headers(request.headers);
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: UpstreamReply;
  try {
    upstream = await requestUpstream(
      `${baseUrl}${url.pathname}${url.search}`,
      request.method,
      headers,
      hasBody ? await request.arrayBuffer() : undefined,
      request.signal
    );
  } catch (error) {
    console.error('[embed] Robot proxy unreachable:', baseUrl, error);
    return new Response(`The robot proxy at ${baseUrl} could not be reached.`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const responseHeaders = upstream.headers;
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  // The proxy already maps redirects onto /<port>/ of its own origin, which the frame has to follow
  // on this host instead. Absolute, because the shell does not resolve a relative Location.
  const location = responseHeaders.get('location');
  if (location) {
    const target = new URL(location, `${baseUrl}${url.pathname}`);
    if (target.origin === baseUrl) {
      responseHeaders.set('location', new URL(`${target.pathname}${target.search}${target.hash}`, url).href);
    }
  }

  const bodiless = BODILESS_STATUSES.has(upstream.status) || request.method === 'HEAD';
  if (bodiless) await upstream.body?.cancel();
  return new Response(bodiless ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

/** Accepts registrations from the app's own top-level page, never from a frame inside it. */
export const registerEmbedProxy = (): void => {
  ipcMain.on('roboboy:embed-register', (event, baseUrl: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    if (!addEmbedTarget(baseUrl)) console.warn('[embed] Refused embed target:', baseUrl);
  });
};
