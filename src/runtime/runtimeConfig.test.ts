import { describe, expect, it } from 'vitest';
import { resolveRuntimeEndpoints } from './runtimeConfig';

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
      mode: 'web',
      host: '192.168.1.20',
    });
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
      webBackendMode: 'auto',
    });

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
  });
});
