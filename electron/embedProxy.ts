import { ipcMain, net } from 'electron';
import { EMBED_PORT_PATH, embedHostFor, isEmbedHost, normalizeEmbedBaseUrl, parseEmbedPorts } from '../src/runtime/embedTarget';

/**
 * Forwards a connection's embed host to the robot proxy it stands for.
 *
 * A panel frames `/<port>/` beside its sandbox. In a browser that path is served by the robot's
 * own Robo-Boy proxy, which publishes the ports its deployment allows; here the sandbox sits on
 * `app://embed-<id>/` and this forwards the same path to that proxy, so the robot's allowlist
 * decides exactly as it does for a browser. Hosts nobody registered reach nothing.
 *
 * A robot that runs no such proxy can publish ports directly instead. For a target registered with
 * `directPorts`, `/<port>/<path>` is fetched from `http://<robot>:<port>/<path>`, with the prefix
 * stripped just as the proxy strips it, and every port outside that list is refused: the app's
 * list is then the only allowlist.
 */

export { isEmbedHost };

interface EmbedTarget {
  baseUrl: string;
  directPorts: Set<number>;
}

const targets = new Map<string, EmbedTarget>();

/** Records a robot the renderer is about to frame, returning its host or null if refused. */
export const addEmbedTarget = (value: unknown, directPorts: unknown = []): string | null => {
  const baseUrl = typeof value === 'string' ? normalizeEmbedBaseUrl(value) : null;
  if (!baseUrl) return null;
  const host = embedHostFor(baseUrl);
  targets.set(host, { baseUrl, directPorts: new Set(parseEmbedPorts(directPorts)) });
  return host;
};

/** `http://<robot>:<port>`, the origin a direct port is fetched from. */
const directOrigin = (baseUrl: string, port: number): string => {
  const url = new URL(baseUrl);
  url.protocol = 'http:';
  url.port = String(port);
  return url.origin;
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

  const target = targets.get(url.hostname);
  if (!target) return notFound('No robot is registered for this embed host.');
  const portPath = EMBED_PORT_PATH.exec(url.pathname);
  if (!portPath) return notFound('Only /<port>/ paths are forwarded to the robot.');

  // Through the robot's proxy, which keeps the /<port> prefix and its own allowlist; or straight to
  // an allowed port, whose server knows nothing of the prefix.
  const port = Number(portPath[1]);
  const direct = target.directPorts.size > 0;
  if (direct && !target.directPorts.has(port)) return notFound(`Port ${port} is not published for embedding.`);
  const origin = direct ? directOrigin(target.baseUrl, port) : target.baseUrl;
  const prefix = direct ? `/${port}` : '';
  const upstreamPath = direct ? url.pathname.slice(prefix.length) || '/' : url.pathname;

  const headers = new Headers(request.headers);
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: UpstreamReply;
  try {
    upstream = await requestUpstream(
      `${origin}${upstreamPath}${url.search}`,
      request.method,
      headers,
      hasBody ? await request.arrayBuffer() : undefined,
      request.signal
    );
  } catch (error) {
    console.error('[embed] Robot unreachable:', origin, error);
    return new Response(`${direct ? 'The robot' : 'The robot proxy'} at ${origin} could not be reached.`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const responseHeaders = upstream.headers;
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  // The proxy already maps redirects onto /<port>/ of its own origin; a direct port redirects within
  // its own root. Either way the frame has to follow on this host, under /<port>/ for a direct one.
  // Absolute, because the shell does not resolve a relative Location.
  const location = responseHeaders.get('location');
  if (location) {
    const redirect = new URL(location, `${origin}${upstreamPath}`);
    if (redirect.origin === origin) {
      responseHeaders.set('location', new URL(`${prefix}${redirect.pathname}${redirect.search}${redirect.hash}`, url).href);
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
  ipcMain.on('roboboy:embed-register', (event, baseUrl: unknown, directPorts: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    if (!addEmbedTarget(baseUrl, directPorts)) console.warn('[embed] Refused embed target:', baseUrl);
  });
};
