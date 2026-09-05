import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawsOwnWindowChrome, isMobilePlatform, resolveRuntimeEndpoints } from './runtimeConfig';

describe('resolveRuntimeEndpoints', () => {
  it('keeps the same-origin proxy contract for domain-based web connections', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'domain', ros2Value: 10 }, false, {
      protocol: 'https:',
      hostname: 'robot.local',
      host: 'robot.local:8443',
    });

    expect(endpoints).toEqual({
      rosbridgeUrl: 'wss://robot.local:8443/websocket',
      videoStreamBaseUrl: '/video_stream',
      meshResourcesBaseUrl: '/mesh_resources',
      ollamaBaseUrl: '/ollama',
      mode: 'web',
      host: 'robot.local',
    });
  });

  it('uses the landing-page host for remote web backend connections', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: '192.168.1.20' }, false, {
      protocol: 'http:',
      hostname: 'operator.local',
      host: 'operator.local',
    });

    expect(endpoints).toEqual({
      rosbridgeUrl: 'ws://192.168.1.20:9090',
      videoStreamBaseUrl: 'http://192.168.1.20:8080',
      meshResourcesBaseUrl: 'http://192.168.1.20:8000',
      ollamaBaseUrl: 'http://192.168.1.20:11434',
      mode: 'web',
      host: '192.168.1.20',
    });
  });

  it('repairs comma-separated IPv4 typos before building endpoint URLs', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: '192,168,1,20' }, false, {
      protocol: 'http:',
      hostname: 'operator.local',
      host: 'operator.local',
    });

    expect(endpoints.rosbridgeUrl).toBe('ws://192.168.1.20:9090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://192.168.1.20:8080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://192.168.1.20:8000');
    expect(endpoints.host).toBe('192.168.1.20');
  });

  it('accepts VPN DNS names for remote web backend connections', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: 'robot.tailnet.ts.net' }, false, {
      protocol: 'http:',
      hostname: 'operator.tailnet.ts.net',
      host: 'operator.tailnet.ts.net',
    });

    expect(endpoints).toEqual({
      rosbridgeUrl: 'ws://robot.tailnet.ts.net:9090',
      videoStreamBaseUrl: 'http://robot.tailnet.ts.net:8080',
      meshResourcesBaseUrl: 'http://robot.tailnet.ts.net:8000',
      ollamaBaseUrl: 'http://robot.tailnet.ts.net:11434',
      mode: 'web',
      host: 'robot.tailnet.ts.net',
    });
  });

  it('can force web host connections through the same-origin proxy', () => {
    const endpoints = resolveRuntimeEndpoints(
      { ros2Option: 'ip', ros2Value: '192.168.1.20' },
      false,
      {
        protocol: 'http:',
        hostname: 'operator.local',
        host: 'operator.local',
      },
      {
        rosbridgePort: '9090',
        videoStreamPort: '8080',
        meshResourcesPort: '8000',
        ollamaPort: '11434',
        webBackendMode: 'proxy',
      }
    );

    expect(endpoints.rosbridgeUrl).toBe('ws://operator.local/websocket');
    expect(endpoints.videoStreamBaseUrl).toBe('/video_stream');
    expect(endpoints.meshResourcesBaseUrl).toBe('/mesh_resources');
  });

  it('connects the desktop shell directly to an installed ROS stack', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: '192.168.1.20' }, true);

    expect(endpoints).toEqual({
      rosbridgeUrl: 'ws://192.168.1.20:9090',
      videoStreamBaseUrl: 'http://192.168.1.20:8080',
      meshResourcesBaseUrl: 'http://192.168.1.20:8000',
      ollamaBaseUrl: 'http://192.168.1.20:11434',
      mode: 'desktop',
      host: '192.168.1.20',
    });
  });

  it('uses localhost for desktop domain configuration', () => {
    expect(resolveRuntimeEndpoints({ ros2Option: 'domain', ros2Value: 14 }, true).host).toBe('localhost');
  });

  it('accepts a URL in the desktop host field', () => {
    expect(resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: 'http://robot.local:1234/path' }, true).host).toBe(
      'robot.local'
    );
  });

  it('wraps IPv6 hosts when constructing service URLs', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: '[::1]' }, true);
    expect(endpoints.rosbridgeUrl).toBe('ws://[::1]:9090');
  });

  it('allows desktop direct-connect ports to be overridden', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: 'robot.local' }, true, undefined, {
      rosbridgePort: '19090',
      videoStreamPort: '18080',
      meshResourcesPort: '18000',
      ollamaPort: '11435',
      webBackendMode: 'auto',
    });

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
    expect(endpoints.ollamaBaseUrl).toBe('http://robot.local:11435');
  });

  it('allows the landing page connection to override service ports', () => {
    const endpoints = resolveRuntimeEndpoints(
      {
        ros2Option: 'ip',
        ros2Value: 'robot.local',
        rosbridgePort: '19090',
        videoStreamPort: '18080',
        meshResourcesPort: '18000',
      },
      false,
      {
        protocol: 'http:',
        hostname: 'operator.local',
        host: 'operator.local',
      }
    );

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
  });

  it('repairs comma-formatted service ports from the landing page', () => {
    const endpoints = resolveRuntimeEndpoints(
      {
        ros2Option: 'ip',
        ros2Value: 'robot.local',
        rosbridgePort: '19,090',
        videoStreamPort: '18,080',
        meshResourcesPort: '18,000',
      },
      true
    );

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
  });
});

describe('isMobilePlatform', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15';

  it('spots the devices that draw their own bars around the app', () => {
    expect(isMobilePlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isMobilePlatform({ userAgent: LINUX, maxTouchPoints: 0 })).toBe(false);
  });

  // iPadOS claims to be a Mac in a full-screen web view, and only the touch screen tells them apart.
  it('reads a touchable Mac as an iPad', () => {
    expect(isMobilePlatform({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true);
    expect(isMobilePlatform({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
  });
});

describe('drawsOwnWindowChrome', () => {
  const shellWindow = window as typeof window & { __TAURI_INTERNALS__?: unknown };

  afterEach(() => {
    delete shellWindow.__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  const runOn = (userAgent: string, maxTouchPoints: number) => {
    shellWindow.__TAURI_INTERNALS__ = {};
    vi.stubGlobal('navigator', { ...navigator, userAgent, maxTouchPoints });
    return drawsOwnWindowChrome();
  };

  it("is the app's job only in an undecorated desktop window", () => {
    expect(runOn('Mozilla/5.0 (X11; Linux x86_64)', 0)).toBe(true);
    expect(runOn('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 5)).toBe(false);
  });

  it('leaves the browser its own chrome', () => {
    expect(drawsOwnWindowChrome()).toBe(false);
  });
});
