import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('electron', () => ({ net: native, ipcMain: { on: vi.fn() } }));
import { addEmbedTarget, fetchEmbed } from './embedProxy';

/** Enough of Electron's ClientRequest: headers in, a body out, then a response or a redirect. */
class FakeRequest extends EventEmitter {
  headers: Record<string, string> = {};
  body: Buffer | undefined;
  aborted = false;
  constructor(private readonly reply: (request: FakeRequest) => void) {
    super();
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {
    this.aborted = true;
  }
  end(body?: Buffer) {
    this.body = body;
    queueMicrotask(() => this.reply(this));
  }
}

const respond =
  (statusCode: number, headers: Record<string, string | string[]>, body = '') =>
  (request: FakeRequest) => {
    const message = Object.assign(new EventEmitter(), { statusCode, statusMessage: 'OK', headers });
    request.emit('response', message);
    queueMicrotask(() => {
      if (body) message.emit('data', Buffer.from(body));
      message.emit('end');
    });
  };

const upstream = (reply: (request: FakeRequest) => void) => {
  const request = new FakeRequest(reply);
  native.request.mockReturnValueOnce(request);
  return request;
};

const sandbox = () => Promise.resolve(new Response('<sandbox>', { headers: { 'content-type': 'text/html' } }));
const host = addEmbedTarget('https://robot.local')!;
const request = (path: string, init?: RequestInit) => new Request(`app://${host}${path}`, init);

describe('embed proxy', () => {
  // Braces matter: a function returned from beforeEach is run as a cleanup hook.
  beforeEach(() => {
    native.request.mockReset();
  });

  it('refuses targets that are not a plain http(s) origin', () => {
    for (const value of [undefined, 42, 'file:///etc/passwd', 'https://user:pw@robot.local', 'https://robot.local/x']) {
      expect(addEmbedTarget(value)).toBeNull();
    }
  });

  it('serves the panel sandbox on the embed host without reaching the robot', async () => {
    const response = await fetchEmbed(request('/panel-sandbox.html?parentOrigin=app%3A%2F%2Frobo-boy'), sandbox);
    expect(await response.text()).toBe('<sandbox>');
    expect(native.request).not.toHaveBeenCalled();
  });

  it('forwards /<port>/ paths to the registered robot proxy, as the browser route does', async () => {
    const sent = upstream(
      respond(
        200,
        {
          'content-type': 'text/javascript',
          'content-encoding': 'gzip',
          'content-length': '12',
          'set-cookie': ['session=robot'],
          'access-control-allow-origin': '*',
          'x-viewer-session': 'abc',
        },
        'decoded body'
      )
    );

    const response = await fetchEmbed(
      request('/8089/api/state?x=1', { headers: { cookie: 'operator=1', 'accept-encoding': 'gzip', range: 'bytes=0-1' } }),
      sandbox
    );

    expect(await response.text()).toBe('decoded body');
    expect(native.request).toHaveBeenCalledWith({
      url: 'https://robot.local/8089/api/state?x=1',
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
    });
    expect(sent.headers).toEqual({ range: 'bytes=0-1' });
    expect(sent.body).toBeUndefined();
    // The shell hands the body over decoded; the upstream's encoding would make it be decoded twice.
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-viewer-session')).toBe('abc');
  });

  it('carries request bodies and hands redirects back on the embed host', async () => {
    const sent = upstream(request =>
      request.emit('redirect', 303, 'POST', 'https://robot.local/8089/done', { location: ['/8089/done'] })
    );

    const response = await fetchEmbed(request('/8089/submit', { method: 'POST', body: 'a=1' }), sandbox);

    expect(sent.body?.toString()).toBe('a=1');
    expect(sent.aborted).toBe(true);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`app://${host}/8089/done`);
  });

  it('leaves redirects to other origins alone', async () => {
    upstream(request => request.emit('redirect', 302, 'GET', 'https://login.example/', {}));
    const response = await fetchEmbed(request('/8089/'), sandbox);
    expect(response.headers.get('location')).toBe('https://login.example/');
  });

  it('reaches nothing for unregistered hosts or paths outside /<port>/', async () => {
    expect((await fetchEmbed(new Request('app://embed-0000000000000000/8089/'), sandbox)).status).toBe(404);
    expect((await fetchEmbed(request('/index.html'), sandbox)).status).toBe(404);
    expect(native.request).not.toHaveBeenCalled();
  });

  it('reports an unreachable robot proxy instead of failing the request', async () => {
    upstream(request => request.emit('error', new Error('net::ERR_CONNECTION_REFUSED')));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await fetchEmbed(request('/8089/'), sandbox)).status).toBe(502);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
