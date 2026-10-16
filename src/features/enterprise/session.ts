import { enterpriseEnabled, enterpriseOrigin, managedGateway } from './config';
import { isDesktopRuntime } from '../../runtime/platform';

export interface EnterpriseRobot {
  id: string;
  name: string;
}
export interface EnterpriseSession {
  robots?: EnterpriseRobot[];
  user: { id: string; name: string };
  expires: number;
  token?: string;
  media?: string;
}
let session: EnterpriseSession | null = null;
export const getEnterpriseSession = () => session;
export const setEnterpriseSession = (value: EnterpriseSession | null) => {
  session = value;
};
export const nativeAuthToken = () => (enterpriseEnabled() && isDesktopRuntime() ? session?.token : undefined);

/** Credentials only reach this build's enterprise origin, never a panel-selected URL. */
export async function enterpriseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!managedGateway()) return fetch(input, init);
  const origin = enterpriseOrigin();
  const source = input instanceof Request ? input.url : String(input);
  const url = new URL(source, origin);
  if (url.origin !== origin) return fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const token = nativeAuthToken();
  if (token) headers.set('X-RoboBoy-Session', token);
  return fetch(input instanceof Request ? new Request(url, input) : url.href, {
    ...init,
    headers,
    credentials: token ? 'omit' : 'include',
    redirect: 'error',
  });
}

/** Images and recording workers cannot attach headers. Native sessions get a read-only scoped URL. */
export function enterpriseMediaUrl(value: string): string {
  if (!enterpriseEnabled() || !isDesktopRuntime() || !session?.media) return value;
  const origin = enterpriseOrigin();
  const url = new URL(value, origin);
  if (
    url.origin !== origin ||
    !/^\/(?:robots\/[a-z][a-z0-9-]{0,63}\/)?(video_stream|mesh_resources|recordings)(\/|$)/.test(url.pathname)
  )
    return value;
  return `${origin}/auth/media/${session.media}${url.pathname}${url.search}`;
}

export function parseSession(value: unknown, native = false): EnterpriseSession {
  const result = value as EnterpriseSession;
  if (
    !result?.user ||
    (result.robots !== undefined &&
      (!Array.isArray(result.robots) ||
        result.robots.length > 64 ||
        result.robots.some(
          robot =>
            !robot ||
            !/^[a-z][a-z0-9-]{0,63}$/.test(robot.id) ||
            typeof robot.name !== 'string' ||
            !robot.name.trim() ||
            robot.name.length > 100
        ) ||
        new Set(result.robots.map(robot => robot.id)).size !== result.robots.length)) ||
    typeof result.user.id !== 'string' ||
    !result.user.id ||
    typeof result.user.name !== 'string' ||
    !Number.isFinite(result.expires) ||
    result.expires <= Date.now() ||
    (native && (!/^[A-Za-z0-9_-]{43}$/.test(result.token ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(result.media ?? '')))
  )
    throw new Error('The server returned an invalid sign-in.');
  return result;
}

export async function nativeSignIn(
  signal: AbortSignal,
  openBrowser: (url: string) => Promise<void>
): Promise<EnterpriseSession> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const challenge = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const origin = enterpriseOrigin();
  const post = (path: string, value: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify(value),
      signal,
    });
  const started = await post('/auth/native/start', { challenge });
  if (!started.ok) throw new Error('Sign-in could not start. Contact your administrator.');
  const { id, browserUrl } = await started.json();
  const target = new URL(browserUrl);
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(id) ||
    target.origin !== origin ||
    target.pathname !== '/auth/login' ||
    target.searchParams.get('native') !== id
  )
    throw new Error('The sign-in address was rejected.');
  await openBrowser(target.href);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const response = await post('/auth/native/poll', { id, secret });
    if (response.status === 200) return parseSession(await response.json(), true);
    if (response.status !== 202) throw new Error('Sign-in expired or was rejected. Start again.');
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('Sign-in expired. Start again.');
}

/** Robot IDs come from the authenticated deployment registry, never arbitrary upstream URLs. */
export function enterpriseRobot(id?: string): EnterpriseRobot | undefined {
  const robots = session?.robots ?? [];
  if (!robots.length) {
    if (id) throw new Error('This robot is no longer available. Choose a robot again.');
    return undefined;
  }
  const robot = id ? robots.find(robot => robot.id === id) : robots[0];
  if (!robot) throw new Error('This robot is no longer available. Choose a robot again.');
  return robot;
}
