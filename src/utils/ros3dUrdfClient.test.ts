import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const roslibMock = vi.hoisted(() => ({
  topicInstances: [] as Array<{
    name: string;
    callback?: (message: unknown) => void;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('roslib', () => ({
  Topic: vi.fn(function Topic(options: { name: string }) {
    const instance = {
      name: options.name,
      callback: undefined as ((message: unknown) => void) | undefined,
      subscribe: vi.fn((callback: (message: unknown) => void) => {
        instance.callback = callback;
      }),
      unsubscribe: vi.fn(),
    };
    roslibMock.topicInstances.push(instance);
    return instance;
  }),
}));

describe('UrdfClient cache', () => {
  const urdf = `
    <robot name="cached_bot">
      <link name="base_link">
        <visual>
          <geometry>
            <box size="1 1 1" />
          </geometry>
        </visual>
      </link>
    </robot>
  `;

  beforeEach(() => {
    vi.resetModules();
    roslibMock.topicInstances = [];
  });

  it('reuses a cached URDF model without resubscribing to robot_description', async () => {
    const { UrdfClient } = await import('./ros3d');
    const rootObject = new THREE.Scene();
    const tfClient = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      lookupTransform: vi.fn(() => null),
    };
    const ros = { url: 'ws://robot' };

    let firstModel: THREE.Object3D | undefined;
    const firstClient = new UrdfClient({
      ros: ros as any,
      tfClient: tfClient as any,
      rootObject,
      robotDescriptionTopic: '/robot_description',
      onComplete: (model) => {
        firstModel = model;
      },
    });

    expect(roslibMock.topicInstances).toHaveLength(1);
    expect(firstClient.userData.preserveAcrossViewerCleanup).toBe(true);
    roslibMock.topicInstances[0].callback?.({ data: urdf });
    expect(roslibMock.topicInstances[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(firstModel).toBeDefined();

    firstClient.dispose();
    expect(rootObject.children).not.toContain(firstClient);

    let secondModel: THREE.Object3D | undefined;
    const secondClient = new UrdfClient({
      ros: ros as any,
      tfClient: tfClient as any,
      rootObject,
      robotDescriptionTopic: '/robot_description',
      onComplete: (model) => {
        secondModel = model;
      },
    });

    await Promise.resolve();

    expect(roslibMock.topicInstances).toHaveLength(1);
    expect(secondModel).toBe(firstModel);
    expect(rootObject.children).toContain(secondClient);
  });
});
