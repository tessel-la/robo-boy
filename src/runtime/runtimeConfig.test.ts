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
      ollamaBaseUrl: '/ollama',
      panelManagerBaseUrl: '',
      panelRegistryUrl: '',
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
      panelManagerBaseUrl: '',
      panelRegistryUrl: '',
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
      panelManagerBaseUrl: '',
      panelRegistryUrl: '',
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
        webProxyPort: '80',
        webBackendMode: 'proxy',
      }
    );

    expect(endpoints.rosbridgeUrl).toBe('ws://operator.local/websocket');
    expect(endpoints.videoStreamBaseUrl).toBe('/video_stream');
    expect(endpoints.meshResourcesBaseUrl).toBe('/mesh_resources');
  });

  it('routes the desktop shell through the deployment proxy on one port', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: '192.168.1.20' }, true);

    expect(endpoints).toEqual({
      rosbridgeUrl: 'ws://192.168.1.20:80/websocket',
      videoStreamBaseUrl: 'http://192.168.1.20:80/video_stream',
      meshResourcesBaseUrl: 'http://192.168.1.20:80/mesh_resources',
      ollamaBaseUrl: 'http://192.168.1.20:11434',
      panelManagerBaseUrl: 'http://192.168.1.20:80',
      panelRegistryUrl: 'http://192.168.1.20:80/panels/installed.json',
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
    expect(endpoints.rosbridgeUrl).toBe('ws://[::1]:80/websocket');
  });

  it('still supports desktop direct-connect ports as an explicit escape hatch', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: 'robot.local' }, true, undefined, {
      rosbridgePort: '19090',
      videoStreamPort: '18080',
      meshResourcesPort: '18000',
      ollamaPort: '11435',
      webProxyPort: '80',
      webBackendMode: 'direct',
    });

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
    expect(endpoints.ollamaBaseUrl).toBe('http://robot.local:11435');
    // Neither the panel manager nor the panel registry has a direct port, so both stay on the
    // proxy origin either way.
    expect(endpoints.panelManagerBaseUrl).toBe('http://robot.local:80');
    expect(endpoints.panelRegistryUrl).toBe('http://robot.local:80/panels/installed.json');
  });

  it('serves the desktop shell a proxy port override', () => {
    const endpoints = resolveRuntimeEndpoints({ ros2Option: 'ip', ros2Value: 'robot.local' }, true, undefined, {
      rosbridgePort: '9090',
      videoStreamPort: '8080',
      meshResourcesPort: '8000',
      ollamaPort: '11434',
      webProxyPort: '8443',
      webBackendMode: 'auto',
    });

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:8443/websocket');
    expect(endpoints.panelManagerBaseUrl).toBe('http://robot.local:8443');
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
      false,
      { protocol: 'http:', hostname: 'operator.local', host: 'operator.local' }
    );

    expect(endpoints.rosbridgeUrl).toBe('ws://robot.local:19090');
    expect(endpoints.videoStreamBaseUrl).toBe('http://robot.local:18080');
    expect(endpoints.meshResourcesBaseUrl).toBe('http://robot.local:18000');
  });
});
