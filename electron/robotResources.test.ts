import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({ net: native, protocol: { handle: vi.fn() } }));
import { fetchRobotResource } from './robotResources';

const request = (target = 'http://robot.local:18000/assets/a.obj', method = 'GET') =>
  Object.assign(
    new Request(
      `robot-resource://localhost/resource?${new URLSearchParams({ base: 'http://robot.local:18000/assets', url: target })}`,
      { method, headers: { origin: 'app://robo-boy' } }
    ),
    { initiatorOrigin: 'app://robo-boy' }
  );

describe('native robot resource requests', () => {
  beforeEach(() => native.fetch.mockReset());

  it.each(['null', undefined, 'https://untrusted.example'])(
    'rejects an untrusted initiator %s',
    async initiatorOrigin => {
      expect((await fetchRobotResource(Object.assign(request(), { initiatorOrigin }))).status).toBe(403);
      expect(native.fetch).not.toHaveBeenCalled();
    }
  );

  it('returns non-CORS asset bytes without forwarding credentials or arbitrary headers', async () => {
    native.fetch.mockResolvedValue(
      new Response('mesh', { headers: { 'content-type': 'application/octet-stream', 'set-cookie': 'secret=value' } })
    );
    const response = await fetchRobotResource(request());
    expect(await response.text()).toBe('mesh');
    expect(response.headers.get('access-control-allow-origin')).toBe('app://robo-boy');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(native.fetch).toHaveBeenCalledWith(
      'http://robot.local:18000/assets/a.obj',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
      })
    );
  });

  it('allows relative redirects on the selected resource server', async () => {
    native.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'b.obj' } }))
      .mockResolvedValueOnce(new Response('mesh'));
    expect(await (await fetchRobotResource(request())).text()).toBe('mesh');
    expect(native.fetch.mock.calls[1][0]).toBe('http://robot.local:18000/assets/b.obj');
  });

  it.each([
    'http://robot.local:8000/assets/a.obj',
    'http://other/assets/a.obj',
    '/private/a.obj',
    'file:///etc/passwd',
  ])('rejects a redirect outside the selected server scope: %s', location => {
    native.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    return fetchRobotResource(request()).then(response => {
      expect(response.status).toBe(403);
      expect(native.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('does not send invalid requests or write methods', async () => {
    expect((await fetchRobotResource(request('file:///etc/passwd'))).status).toBe(403);
    expect((await fetchRobotResource(request(undefined, 'POST'))).status).toBe(405);
    expect(native.fetch).not.toHaveBeenCalled();
  });

  it('preserves missing-material status for the existing OBJ fallback', async () => {
    native.fetch.mockResolvedValue(new Response('missing', { status: 404 }));
    const response = await fetchRobotResource(request());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('missing');
  });
});
