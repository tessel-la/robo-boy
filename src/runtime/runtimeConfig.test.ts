import { describe, expect, it } from 'vitest';
import { resolveRuntimeEndpoints } from './runtimeConfig';

describe('resolveRuntimeEndpoints', () => {
  it('keeps the same-origin proxy contract for the web app', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: '192.168.1.20' }, false, {
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
    });

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
  });
});
