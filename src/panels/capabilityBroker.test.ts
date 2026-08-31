import { describe, expect, it, vi } from 'vitest';
import { connectPanelCapabilityBroker, getGrantedPanelEndpoints, resourceMatches } from './capabilityBroker';
import type { ResolvedPanelManifest } from './types';

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
        runtimeEndpoints: { videoStream: 'https://robot.example:8080' },
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
