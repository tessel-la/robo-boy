import { net, protocol } from 'electron';
import { isRobotResourceUrl } from '../src/runtime/robotResourceScope';

export const robotResourceScheme = {
  scheme: 'robot-resource',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

/** Native GETs for the selected mesh server, never a renderer-wide CORS exemption. */
export async function fetchRobotResource(
  request: Request & { initiatorOrigin?: string },
  rendererOrigin = 'app://robo-boy'
): Promise<Response> {
  const headers = { ...securityHeaders, 'Access-Control-Allow-Origin': rendererOrigin };
  // Electron provides this trusted field separately from the optional Origin/referrer headers.
  // Opaque panel frames and browser-initiated navigations must never gain native asset reads.
  if (request.initiatorOrigin !== rendererOrigin) return new Response(null, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const base = params.get('base') ?? '';
  let target = params.get('url') ?? '';
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!isRobotResourceUrl(base, target)) return new Response(null, { status: 403, headers });
      const response = await net.fetch(target, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
        target = new URL(response.headers.get('location')!, target).href;
        await response.body?.cancel();
        continue;
      }
      return new Response(response.body, {
        status: response.status,
        headers: { ...headers, 'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream' },
      });
    }
  } catch (error) {
    console.error('[robot-resource] Fetch failed:', target, error);
  }
  return new Response(null, { status: 502, headers });
}

export const registerRobotResources = (rendererOrigin = 'app://robo-boy'): void => {
  protocol.handle('robot-resource', request => fetchRobotResource(request, rendererOrigin));
};
