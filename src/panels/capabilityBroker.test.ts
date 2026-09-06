import { describe, expect, it, vi } from 'vitest';
import {
  isGrantedHostEndpointUrl,
  connectPanelCapabilityBroker,
  getGrantedPanelEndpoints,
  normalizeRosMessage,
  resourceMatches,
} from './capabilityBroker';
import type { ResolvedPanelManifest } from './types';
import { resolveRuntimeEndpoints } from '../runtime/runtimeConfig';

const manifest: ResolvedPanelManifest = {
  schemaVersion: 1,
  id: 'com.example.panel',
  name: 'Example',
  description: 'Example panel.',
  version: '2.0.0',
  entryPoint: 'https://roboboy.test/panels/example/2.0.0/index.js',
  integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
  registryUrl: 'https://roboboy.test/panels/installed.json',
  compatibility: { panelApi: '^2.0.0', roboboy: '*' },
  capabilities: ['network'],
  permissions: { network: { origins: ['https://allowed.example'], hostEndpoints: ['videoStream'] } },
  author: { name: 'Example' },
  repository: 'https://github.com/example/panel',
};

describe('panel capability broker', () => {
  it('subscribes when randomUUID is unavailable on a plain-HTTP remote origin', async () => {
    const port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    } as unknown as MessagePort;
    const ros = {
      idCounter: 0,
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      callOnConnection: vi.fn(),
    };
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {});

    try {
      const disconnect = connectPanelCapabilityBroker(
        port,
        {
          manifest: {
            ...manifest,
            capabilities: ['ros'],
            permissions: { ros: { subscribe: ['/joint_states'] } },
          },
          ros: ros as never,
          runtime: { target: 'web' },
          runtimeEndpoints: {},
          hostElement: document.createElement('div'),
          logger: console,
        },
        vi.fn()
      );

      port.onmessage?.({
        data: {
          type: 'request',
          requestId: 'subscribe-remote',
          method: 'ros.subscribe',
          params: {
            topic: '/joint_states',
            messageType: 'sensor_msgs/msg/JointState',
          },
        },
      } as MessageEvent);

      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'response',
          requestId: 'subscribe-remote',
          value: { subscriptionId: 'subscription-1' },
        })
      );
      expect(ros.callOnConnection).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'subscribe', topic: '/joint_states' })
      );
      disconnect();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('normalizes ROS messages with non-finite values before crossing the sandbox boundary', () => {
    class RosMessage {
      position = [1.25, 2.5];
      effort = [Number.NaN, Number.POSITIVE_INFINITY];
    }

    const normalized = normalizeRosMessage(new RosMessage());

    expect(normalized?.value).toEqual({
      position: [1.25, 2.5],
      effort: [null, null],
    });
    expect(normalized?.byteLength).toBeGreaterThan(0);
  });

  it('matches ROS resources without allowing sibling namespaces', () => {
    expect(resourceMatches('/telemetry/**', '/telemetry/drive/speed')).toBe(true);
    expect(resourceMatches('/telemetry/*', '/telemetry/speed')).toBe(true);
    expect(resourceMatches('/telemetry/*', '/telemetry/drive/speed')).toBe(false);
    expect(resourceMatches('/telemetry/**', '/diagnostics/status')).toBe(false);
  });

  it('passes only host endpoints explicitly granted by the manifest', () => {
    expect(
      getGrantedPanelEndpoints(manifest, {
        videoStream: 'https://robot.example/video',
      })
    ).toEqual({ videoStream: 'https://robot.example/video' });
    expect(
      getGrantedPanelEndpoints(
        { ...manifest, permissions: { network: { origins: ['https://allowed.example'] } } },
        { videoStream: 'https://robot.example/video' }
      )
    ).toEqual({});
  });

  it('reveals the ROS graph only to the trusted picker and grants its selected topic', async () => {
    const rosManifest: ResolvedPanelManifest = {
      ...manifest,
      capabilities: ['ros'],
      permissions: { ros: { selectTopic: true } },
    };
    const port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    } as unknown as MessagePort;
    const getTopics = vi.fn((resolve: (value: unknown) => void) =>
      resolve({
        topics: ['/private/system', '/joint_states'],
        types: ['std_msgs/msg/String', 'sensor_msgs/msg/JointState'],
      })
    );
    const requestRosTopicSelection = vi.fn(async topics => topics[1]);
    const userSelectedRosTopics = new Map<string, string>();
    const onRosTopicSelected = vi.fn();
    const disconnect = connectPanelCapabilityBroker(
      port,
      {
        manifest: rosManifest,
        ros: { getTopics } as never,
        runtime: { target: 'web' },
        runtimeEndpoints: {},
        hostElement: document.createElement('div'),
        requestRosTopicSelection,
        userSelectedRosTopics,
        onRosTopicSelected,
        logger: console,
      },
      vi.fn()
    );

    port.onmessage?.({
      data: {
        type: 'request',
        requestId: 'select-topic',
        method: 'ros.selectTopic',
        params: { currentTopic: '/joint_states' },
      },
    } as MessageEvent);

    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'response',
        requestId: 'select-topic',
        value: { name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
      })
    );
    expect(requestRosTopicSelection).toHaveBeenCalledWith(
      [
        { name: '/private/system', messageType: 'std_msgs/msg/String' },
        { name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
      ],
      '/joint_states'
    );
    expect(userSelectedRosTopics).toEqual(new Map([['/joint_states', 'sensor_msgs/msg/JointState']]));
    expect(onRosTopicSelected).toHaveBeenCalledWith({
      name: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState',
    });
    disconnect();
  });

  it('rejects network origins outside the reviewed allowlist before fetch', async () => {
    const port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    } as unknown as MessagePort;
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const disconnect = connectPanelCapabilityBroker(
      port,
      {
        manifest,
        ros: null,
        runtime: { target: 'web' },
        runtimeEndpoints: { videoStream: 'https://robot.example/video' },
        hostElement: document.createElement('div'),
        logger: console,
      },
      vi.fn()
    );

    port.onmessage?.({
      data: {
        type: 'request',
        requestId: 'request-1',
        method: 'network.fetch',
        params: { url: 'https://unapproved.example/private' },
      },
    } as MessageEvent);

    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'request-1',
          error: expect.stringContaining('not permitted'),
        })
      )
    );
    expect(fetcher).not.toHaveBeenCalled();
    disconnect();
    fetcher.mockRestore();
  });

  // The gateway is granted by naming it, not by working it out from the video server, so a panel
  // that asks for it directly gets exactly the same reach as one written before it had a name.
  it('grants the stream gateway to a panel that names it, and nothing beside it', () => {
    const endpoints = {
      videoStream: 'https://robot.example:8080',
      webrtcWhep: 'https://gateway.example:8889/',
      webrtcDiscovery: 'https://gateway.example:9997/v3/paths/list',
    };
    const gatewayManifest: ResolvedPanelManifest = {
      ...manifest,
      permissions: { network: { hostEndpoints: ['webrtcWhep', 'webrtcDiscovery'] } },
    };
    const reaches = (url: string) => isGrantedHostEndpointUrl(gatewayManifest, endpoints, new URL(url));

    expect(reaches('https://gateway.example:8889/camera/whep')).toBe(true);
    expect(reaches('https://gateway.example:9997/v3/paths/list')).toBe(true);
    // A gateway somewhere other than the robot is the point: nothing infers it from videoStream.
    expect(reaches('https://robot.example:8889/camera/whep')).toBe(false);
    expect(reaches('https://gateway.example:8889/admin')).toBe(false);
    expect(reaches('https://gateway.example:9997/v3/config')).toBe(false);
  });

  it('limits a host endpoint grant to its known service routes', async () => {
    const endpointOnlyManifest: ResolvedPanelManifest = {
      ...manifest,
      permissions: { network: { hostEndpoints: ['videoStream'] } },
    };
    const port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    } as unknown as MessagePort;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      statusText: 'OK',
      url: 'https://robot.example:8889/camera/whep',
      headers: new Headers({ 'content-type': 'application/sdp', server: 'private-server' }),
      text: async () => 'answer',
    } as Response);
    const disconnect = connectPanelCapabilityBroker(
      port,
      {
        manifest: endpointOnlyManifest,
        ros: null,
        runtime: { target: 'web' },
        runtimeEndpoints: {
          videoStream: 'https://robot.example:8080',
          webrtcWhep: 'https://robot.example:8889/',
          webrtcDiscovery: 'https://robot.example:9997/v3/paths/list',
        },
        hostElement: document.createElement('div'),
        logger: console,
      },
      vi.fn()
    );

    port.onmessage?.({
      data: {
        type: 'request',
        requestId: 'allowed',
        method: 'network.fetch',
        params: { url: 'https://robot.example:8889/camera/whep', method: 'POST', body: 'offer' },
      },
    } as MessageEvent);
    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          requestId: 'allowed',
          value: expect.objectContaining({ headers: { 'content-type': 'application/sdp' } }),
        })
      )
    );

    port.onmessage?.({
      data: {
        type: 'request',
        requestId: 'blocked',
        method: 'network.fetch',
        params: { url: 'https://robot.example:8889/admin' },
      },
    } as MessageEvent);
    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'blocked', error: expect.stringContaining('not permitted') })
      )
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    disconnect();
    fetcher.mockRestore();
  });
});

// The whole chain the WebRTC panel depends on, in one place: what the runtime resolves for a
// deployment, what the panel builds from it, and whether the broker lets that through. It is wired
// across three files and two repositories, so nothing else notices when one end moves.
describe('stream gateway endpoints reach the panel', () => {
  const gatewayManifest: ResolvedPanelManifest = {
    ...manifest,
    permissions: { network: { hostEndpoints: ['webrtcWhep', 'webrtcDiscovery'] } },
  };

  // Exactly what robo-boy-webrtc-panel does with the base it is handed.
  const panelWhepUrl = (whepBase: string, streamPath: string) =>
    new URL(`${streamPath}/whep`, new URL(whepBase, document.baseURI)).toString();

  it.each([
    // A domain connection is what actually stays on the same origin; an empty IP falls through to
    // a direct localhost backend, which is a different deployment entirely.
    ['browser behind the proxy', { ros2Option: 'domain' as const, ros2Value: 10 }, false],
    ['packaged app, direct', { ros2Option: 'ip' as const, ros2Value: 'robot.local' }, true],
  ])('grants what the panel builds for a %s', (_label, params, desktop) => {
    const runtime = resolveRuntimeEndpoints(params, desktop, {
      protocol: 'https:',
      hostname: 'roboboy.test',
      host: 'roboboy.test',
    });
    const endpoints = {
      webrtcWhep: new URL(runtime.webrtcWhepBaseUrl, document.baseURI).href,
      webrtcDiscovery: new URL(runtime.webrtcDiscoveryUrl, document.baseURI).href,
    };

    const whep = panelWhepUrl(endpoints.webrtcWhep, 'manipulator_wrist_camera');
    expect(isGrantedHostEndpointUrl(gatewayManifest, endpoints, new URL(whep))).toBe(true);
    expect(isGrantedHostEndpointUrl(gatewayManifest, endpoints, new URL(endpoints.webrtcDiscovery))).toBe(true);

    // The gateway's other control routes stay out of reach in every deployment.
    const control = new URL('../v3/config/global/get', endpoints.webrtcDiscovery).toString();
    expect(isGrantedHostEndpointUrl(gatewayManifest, endpoints, new URL(control))).toBe(false);

    // The HLS fallback is granted where the gateway is addressable directly, and simply does not
    // exist behind the proxy -- a browser has WebRTC and never reaches for it.
    const hlsManifest: ResolvedPanelManifest = {
      ...manifest,
      permissions: { network: { hostEndpoints: ['webrtcHls'] } },
    };
    const withHls = { ...endpoints, webrtcHls: runtime.webrtcHlsBaseUrl };
    if (desktop) {
      expect(runtime.webrtcHlsBaseUrl).toBe('http://robot.local:8888/');
      for (const file of ['index.m3u8', 'video1_stream.m3u8', 'abc_video1_init.mp4', 'abc_video1_seg10.mp4']) {
        const url = new URL(`manipulator_wrist_camera/${file}`, runtime.webrtcHlsBaseUrl);
        expect(isGrantedHostEndpointUrl(hlsManifest, withHls, url)).toBe(true);
      }
      // Still one stream path deep: nothing else on that port is reachable.
      const deep = new URL('manipulator_wrist_camera/nested/secret.mp4', runtime.webrtcHlsBaseUrl);
      expect(isGrantedHostEndpointUrl(hlsManifest, withHls, deep)).toBe(false);
    } else {
      expect(runtime.webrtcHlsBaseUrl).toBe('');
      const url = new URL('https://roboboy.test:8888/manipulator_wrist_camera/index.m3u8');
      expect(isGrantedHostEndpointUrl(hlsManifest, withHls, url)).toBe(false);
    }
  });
});
