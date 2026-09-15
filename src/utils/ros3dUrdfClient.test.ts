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

const meshLoaderMock = vi.hoisted(() => ({
  mtlLoad: vi.fn(),
  mtlResourcePath: vi.fn(),
  materialsPreload: vi.fn(),
  objLoad: vi.fn(),
  objSetMaterials: vi.fn(),
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

vi.mock('three/examples/jsm/loaders/MTLLoader.js', () => ({
  MTLLoader: class MTLLoader {
    setResourcePath(path: string) {
      meshLoaderMock.mtlResourcePath(path);
      return this;
    }

    load(url: string, onLoad: (materials: { preload: () => void }) => void) {
      meshLoaderMock.mtlLoad(url);
      onLoad({ preload: meshLoaderMock.materialsPreload });
    }
  },
}));

vi.mock('three/examples/jsm/loaders/OBJLoader.js', async () => {
  const THREE = await vi.importActual<typeof import('three')>('three');
  return {
    OBJLoader: class OBJLoader {
      setMaterials(materials: unknown) {
        meshLoaderMock.objSetMaterials(materials);
        return this;
      }

      load(url: string, onLoad: (model: THREE.Group) => void) {
        meshLoaderMock.objLoad(url);
        onLoad(new THREE.Group());
      }
    },
  };
});

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
    vi.clearAllMocks();
    roslibMock.topicInstances = [];
  });

  it('loads companion OBJ materials for name-only URDF materials', async () => {
    const { UrdfClient } = await import('./ros3d');
    const rootObject = new THREE.Scene();
    const tfClient = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      lookupTransform: vi.fn(() => null),
    };
    const requestRender = vi.fn();
    const client = new UrdfClient({
      ros: { url: 'ws://panda-materials' } as any,
      tfClient: tfClient as any,
      rootObject,
      robotDescriptionTopic: '/robot_description',
      requestRender,
    });
    const pandaUrdf = `
      <robot name="panda">
        <link name="panda_link6">
          <visual>
            <geometry>
              <mesh filename="package://meshes/visual/link6.obj" />
            </geometry>
            <material name="panda_white" />
          </visual>
        </link>
      </robot>
    `;

    roslibMock.topicInstances[0].callback?.({ data: pandaUrdf });

    expect(meshLoaderMock.mtlResourcePath).toHaveBeenCalledWith('/mesh_resources/meshes/visual/');
    expect(meshLoaderMock.mtlLoad).toHaveBeenCalledWith('/mesh_resources/meshes/visual/link6.mtl');
    expect(meshLoaderMock.materialsPreload).toHaveBeenCalledOnce();
    expect(meshLoaderMock.objSetMaterials).toHaveBeenCalledOnce();
    expect(meshLoaderMock.objLoad).toHaveBeenCalledWith('/mesh_resources/meshes/visual/link6.obj');
    expect(requestRender).toHaveBeenCalled();

    client.dispose();
  });

  it('reuses only the cached description and builds an independent panel model', async () => {
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
    expect(secondModel).toBeDefined();
    expect(secondModel).not.toBe(firstModel);
    expect(rootObject.children).toContain(secondClient);
  }, 10000);

  it('does not reuse a description across replacement ROS instances with the same URL', async () => {
    const { UrdfClient } = await import('./ros3d');
    const tfClient = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      lookupTransform: vi.fn(() => null),
    };
    const firstClient = new UrdfClient({
      ros: { url: 'ws://same-url' } as any,
      tfClient: tfClient as any,
      rootObject: new THREE.Scene(),
    });
    roslibMock.topicInstances[0].callback?.({ data: urdf });
    firstClient.dispose();

    const replacementClient = new UrdfClient({
      ros: { url: 'ws://same-url' } as any,
      tfClient: tfClient as any,
      rootObject: new THREE.Scene(),
    });

    expect(roslibMock.topicInstances).toHaveLength(2);
    replacementClient.dispose();
  });

  it('disposes the GPU resources owned by its independent model', async () => {
    const { UrdfClient } = await import('./ros3d');
    const tfClient = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      lookupTransform: vi.fn(() => null),
    };
    let model: THREE.Object3D | undefined;
    const client = new UrdfClient({
      ros: { url: 'ws://resource-owner' } as any,
      tfClient: tfClient as any,
      rootObject: new THREE.Scene(),
      onComplete: loadedModel => {
        model = loadedModel;
      },
    });
    roslibMock.topicInstances[0].callback?.({ data: urdf });
    const mesh = model?.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose');

    client.dispose();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it('invalidates rendering for TF motion and releases losing frame candidates', async () => {
    const { UrdfClient } = await import('./ros3d');
    const rootObject = new THREE.Scene();
    const callbacks = new Map<string, (transform: any) => void>();
    const tfClient = {
      subscribe: vi.fn((frameId: string, callback: (transform: any) => void) => {
        callbacks.set(frameId, callback);
        callback(null);
      }),
      unsubscribe: vi.fn(),
      lookupTransform: vi.fn(() => null),
    };
    const requestRender = vi.fn();
    const client = new UrdfClient({
      ros: { url: 'ws://moving-robot' } as any,
      tfClient: tfClient as any,
      rootObject,
      robotDescriptionTopic: '/robot_description',
      requestRender,
    });

    roslibMock.topicInstances[0].callback?.({ data: urdf });
    requestRender.mockClear();
    callbacks.get('base_link')?.({
      translation: new THREE.Vector3(2, 0, 0),
      rotation: new THREE.Quaternion(),
    });

    expect(requestRender).toHaveBeenCalledOnce();
    expect(tfClient.unsubscribe).toHaveBeenCalledWith(
      'cached_bot/base_link',
      expect.any(Function),
    );

    // Identical TF does not wake the GPU again.
    callbacks.get('base_link')?.({
      translation: new THREE.Vector3(2, 0, 0),
      rotation: new THREE.Quaternion(),
    });
    expect(requestRender).toHaveBeenCalledOnce();

    client.dispose();
  });

  it('composes URDF fixed-axis roll, pitch, yaw for joints and visuals', async () => {
    const { UrdfClient } = await import('./ros3d');
    const rootObject = new THREE.Scene();
    const tfClient = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      lookupTransform: vi.fn(() => null),
    };
    let model: THREE.Object3D | undefined;
    const client = new UrdfClient({
      ros: { url: 'ws://rpy-robot' } as any,
      tfClient: tfClient as any,
      rootObject,
      robotDescriptionTopic: '/robot_description',
      onComplete: (loadedModel) => {
        model = loadedModel;
      },
    });
    const rpyUrdf = `
      <robot name="rpy_bot">
        <link name="base_link" />
        <link name="head_link">
          <visual>
            <origin xyz="0 0 0" rpy="0.1 0.2 0.3" />
            <geometry><box size="0.1 0.1 0.1" /></geometry>
          </visual>
        </link>
        <joint name="head_joint" type="fixed">
          <origin xyz="0 0 0.2" rpy="0.4 0.5 0.6" />
          <parent link="base_link" />
          <child link="head_link" />
        </joint>
      </robot>
    `;

    roslibMock.topicInstances[0].callback?.({ data: rpyUrdf });

    const head = model?.getObjectByName('head_link');
    const visual = head?.children.find((child) => child instanceof THREE.Mesh);
    const expectedJoint = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.4, 0.5, 0.6, 'ZYX')
    );
    const expectedVisual = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.1, 0.2, 0.3, 'ZYX')
    );
    expect(head?.quaternion.angleTo(expectedJoint)).toBeLessThan(1e-7);
    expect(visual?.quaternion.angleTo(expectedVisual)).toBeLessThan(1e-7);

    client.dispose();
  });
});
