import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enterpriseFetch,
  enterpriseSocketToken,
  enterpriseMediaUrl,
  nativeAuthToken,
  nativeSignIn,
  parseSession,
  setEnterpriseSession,
} from './session';
import { enterpriseOrigin } from './config';
import { getDefaultConnectionHost, getDefaultServicePorts, resolveRuntimeEndpoints } from '../../runtime/runtimeConfig';
import { describeConnectionTarget } from '../../runtime/connections';
import { createRobotResourceManager } from '../../runtime/robotResources';
import { fetchListing, remoteBag } from '../recordReplay/remoteRecordings';
import { downloadWithBrowser, RecordingDownload } from '../recordReplay/downloadRecording';

const carrier = window as typeof window & { roboBoyDesktop?: unknown };
const identity = {
  user: { id: 'alice', name: 'Alice' },
  expires: Date.now() + 60000,
  token: 'a'.repeat(43),
  media: 'b'.repeat(43),
};
const enable = (native = true) => {
  vi.stubEnv('VITE_ENTERPRISE_LOGIN', 'true');
  vi.stubEnv('VITE_ENTERPRISE_SERVER_URL', 'https://robot.example');
  if (native) carrier.roboBoyDesktop = {};
};
afterEach(() => {
  setEnterpriseSession(null);
  delete carrier.roboBoyDesktop;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Enterprise transport', () => {
  it('does not change the default workflow', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await enterpriseFetch('https://api.example/status');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.example/status', undefined);
    expect(enterpriseMediaUrl('/video_stream/stream')).toBe('/video_stream/stream');
    expect(nativeAuthToken()).toBeUndefined();
  });

  it('attaches credentials only to the deployment, preserves admin headers, and refuses redirects', async () => {
    enable();
    setEnterpriseSession(identity);
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await enterpriseFetch('/api/panels/status', { headers: { Authorization: 'Bearer admin' } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://robot.example/api/panels/status');
    expect(init.headers.get('X-RoboBoy-Session')).toBe(identity.token);
    expect(init.headers.get('Authorization')).toBe('Bearer admin');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    await enterpriseFetch('https://robot.example.evil/private');
    expect(fetch.mock.calls[1]).toEqual(['https://robot.example.evil/private', undefined]);
    expect(localStorage.getItem('roboboy-enterprise-session')).toBeNull();
  });

  it('uses cookie authentication for web sessions and scopes native media reads', async () => {
    enable(false);
    setEnterpriseSession(identity);
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await enterpriseFetch('/auth/session');
    expect(fetch.mock.calls[0][1].credentials).toBe('include');
    expect(fetch.mock.calls[0][1].headers.has('X-RoboBoy-Session')).toBe(false);
    expect(enterpriseMediaUrl('/video_stream/stream')).toBe('/video_stream/stream');
    carrier.roboBoyDesktop = {};
    expect(enterpriseMediaUrl('https://robot.example/recordings/list')).toBe(
      `https://robot.example/auth/media/${identity.media}/recordings/list`
    );
    expect(enterpriseMediaUrl('https://other.example/recordings/list')).toBe('https://other.example/recordings/list');
    expect(enterpriseMediaUrl('/api/panels/config')).toBe('/api/panels/config');
  });

  it('preserves manual host and port selection after login without a registry', async () => {
    enable();
    setEnterpriseSession({ ...identity, robots: [] });
    expect(getDefaultConnectionHost()).toBe('');
    expect(getDefaultServicePorts().rosbridgePort).toBe('9090');
    const params = { ros2Option: 'ip' as const, ros2Value: '192.168.1.77', rosbridgePort: '19090' };
    const target = describeConnectionTarget(params);
    expect(target.params).toMatchObject(params);
    expect(target.label).toBe('192.168.1.77');
    expect(resolveRuntimeEndpoints(target.params, true)).toMatchObject({
      rosbridgeUrl: 'ws://192.168.1.77:19090',
      videoStreamBaseUrl: 'http://192.168.1.77:8080',
      recordingsBaseUrl: 'http://192.168.1.77:9091',
    });
    expect(enterpriseSocketToken('ws://192.168.1.77:19090')).toBeUndefined();
    expect(enterpriseSocketToken('wss://robot.example.evil/websocket')).toBeUndefined();
    expect(enterpriseSocketToken('wss://robot.example:8443/websocket')).toBeUndefined();
    expect(enterpriseSocketToken()).toBeUndefined();
    expect(enterpriseSocketToken('wss://robot.example/websocket')).toBe(identity.token);
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await enterpriseFetch('http://192.168.1.77:8080/status');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('http://192.168.1.77:8080/status', undefined);
    expect(enterpriseMediaUrl('http://192.168.1.77:8080/video_stream/stream')).toBe(
      'http://192.168.1.77:8080/video_stream/stream'
    );
    const manager = createRobotResourceManager('http://192.168.1.77:8000/mesh_resources');
    expect(manager.resolveURL('http://192.168.1.77:8000/mesh_resources/arm.obj')).not.toContain(identity.media);
    delete carrier.roboBoyDesktop;
    expect(resolveRuntimeEndpoints(params, false, { protocol: 'https:', hostname: 'robot.example' }).rosbridgeUrl).toBe(
      'wss://192.168.1.77:19090'
    );
    expect(
      resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: 'robot.example' }, false, {
        protocol: 'https:',
        hostname: 'robot.example',
        host: 'robot.example:8443',
      }).rosbridgeUrl
    ).toBe('wss://robot.example:8443/websocket');
  });

  it('authenticates final mesh requests without changing canonical relative-resource bases', () => {
    enable();
    setEnterpriseSession(identity);
    const base = 'https://robot.example/mesh_resources';
    const manager = createRobotResourceManager(base);
    for (const path of ['robot/arm.obj', 'robot/arm.mtl', 'robot/textures/paint.png']) {
      expect(manager.resolveURL(`${base}/${path}`)).toBe(
        `https://robot.example/auth/media/${identity.media}/mesh_resources/${path}`
      );
    }
    expect(manager.resolveURL('https://other.example/mesh_resources/arm.obj')).toBe(
      'https://other.example/mesh_resources/arm.obj'
    );
    expect(manager.resolveURL('https://robot.example/private/arm.obj')).toBe('https://robot.example/private/arm.obj');
    expect(base).not.toContain(identity.media);
  });

  it('authenticates recording listings and downloads only at the transport boundary', async () => {
    enable();
    setEnterpriseSession(identity);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1 })))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.close();
            },
          })
        )
      );
    vi.stubGlobal('fetch', fetch);
    await fetchListing('https://robot.example/recordings', '');
    expect(fetch.mock.calls[0][1].headers.get('X-RoboBoy-Session')).toBe(identity.token);
    const bag = remoteBag('https://robot.example/recordings', {
      name: 'bag.mcap',
      path: 'bag.mcap',
      size: 2,
      modified: 0,
    });
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const handle = { createWritable: async () => writable } as unknown as FileSystemFileHandle;
    const download = new RecordingDownload(bag, handle, () => {}, { retryDelays: [] });
    await download.run();
    expect(download.snapshot).toMatchObject({ phase: 'done', loaded: 2 });
    expect(fetch.mock.calls[1][0]).toBe(bag.url);
    expect(fetch.mock.calls[1][1].headers.get('X-RoboBoy-Session')).toBe(identity.token);
    expect(writable.close).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    downloadWithBrowser(bag.url);
    const frame = document.querySelector('iframe')!;
    expect(frame.src).toBe(`https://robot.example/auth/media/${identity.media}/recordings/files/bag.mcap`);
    expect(bag.url).toBe('https://robot.example/recordings/files/bag.mcap');
    vi.advanceTimersByTime(60000);
    expect(frame.isConnected).toBe(false);
  });

  it('keeps robot routes distinct, credential-free and limited to the authenticated registry', () => {
    enable();
    const robots = [
      { id: 'assembly', name: 'Assembly' },
      { id: 'inspection', name: 'Inspection' },
    ];
    setEnterpriseSession({ ...identity, robots });
    expect(getDefaultServicePorts().rosbridgePort).toBe('443');
    const a = describeConnectionTarget({ ros2Option: 'ip', ros2Value: 'ignored', enterpriseRobotId: 'assembly' });
    const b = describeConnectionTarget({ ros2Option: 'ip', ros2Value: 'ignored', enterpriseRobotId: 'inspection' });
    expect(a.key).not.toBe(b.key);
    expect(b.label).toBe('Inspection');
    expect(resolveRuntimeEndpoints(b.params).rosbridgeUrl).toBe('wss://robot.example/robots/inspection/websocket');
    expect(enterpriseMediaUrl('https://robot.example/robots/inspection/recordings/files/a.mcap')).toBe(
      `https://robot.example/auth/media/${identity.media}/robots/inspection/recordings/files/a.mcap`
    );
    expect(enterpriseMediaUrl('https://robot.example/robots/inspection/api/panels')).toBe(
      'https://robot.example/robots/inspection/api/panels'
    );
    expect(JSON.stringify(b)).not.toContain(identity.media);
    expect(() =>
      describeConnectionTarget({ ros2Option: 'ip', ros2Value: 'ignored', enterpriseRobotId: 'missing' })
    ).toThrow('no longer available');
    for (const invalid of [null, [{ id: '../other', name: 'Other' }], [robots[0], robots[0]]])
      expect(() => parseSession({ ...identity, robots: invalid })).toThrow();
  });

  it('fails closed on invalid server URLs and malformed sessions', () => {
    enable();
    for (const url of ['http://public.example', 'https://user:secret@robot.example', 'https://robot.example/private']) {
      vi.stubEnv('VITE_ENTERPRISE_SERVER_URL', url);
      expect(() => enterpriseOrigin()).toThrow();
    }
    for (const value of [{}, { ...identity, expires: 0 }, { ...identity, token: 'wrong' }])
      expect(() => parseSession(value, true)).toThrow();
  });

  it('verifies native handoff URLs before opening a browser', async () => {
    enable();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'x'.repeat(43),
            browserUrl: 'https://evil.example/auth/login?native=' + 'x'.repeat(43),
          })
        )
      )
    );
    const browser = vi.fn();
    await expect(nativeSignIn(new AbortController().signal, browser)).rejects.toThrow('address was rejected');
    expect(browser).not.toHaveBeenCalled();
  });

  it('cancels a pending native sign-in without storing credentials', async () => {
    enable();
    const id = 'x'.repeat(43);
    const browser = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id, browserUrl: 'https://robot.example/auth/login?native=' + id }))
      )
      .mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const result = nativeSignIn(controller.signal, browser);
    await vi.waitFor(() => expect(browser).toHaveBeenCalledOnce());
    controller.abort(new Error('Cancelled'));
    await expect(result).rejects.toThrow('Cancelled');
    expect(nativeAuthToken()).toBeUndefined();
  });
});
