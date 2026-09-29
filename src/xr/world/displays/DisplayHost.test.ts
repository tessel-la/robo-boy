import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { DEFAULT_VISUALIZATION_STATE, type VisualizationPanelState } from '../../../utils/visualizationState';

const mocks = vi.hoisted(() => {
  const created: Array<{ kind: string; layerId: string; dispose: ReturnType<typeof vi.fn> }> = [];
  const tf = {
    configure: vi.fn(),
    setTransforms: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  };
  const display = (kind: string) =>
    vi.fn(function (this: unknown, _env: unknown, layer: { id: string }) {
      const instance = { kind, layerId: layer.id, dispose: vi.fn() };
      created.push(instance);
      return instance;
    });
  return {
    created,
    tf,
    unsubscribe: vi.fn(),
    listener: null as null | ((update: unknown) => void),
    display,
  };
});

vi.mock('../../../utils/tfStream', () => ({
  subscribeToTfStream: (_ros: unknown, listener: (update: unknown) => void) => {
    mocks.listener = listener;
    return mocks.unsubscribe;
  },
}));
vi.mock('./TfDisplay', () => ({
  TfDisplay: vi.fn(function () {
    return mocks.tf;
  }),
}));
vi.mock('./UrdfDisplay', () => ({ UrdfDisplay: mocks.display('urdf') }));
vi.mock('./PointCloudDisplay', () => ({ PointCloudDisplay: mocks.display('pointcloud') }));
vi.mock('./LaserScanDisplay', () => ({ LaserScanDisplay: mocks.display('laserscan') }));
vi.mock('./MarkerArrayDisplay', () => ({ MarkerArrayDisplay: mocks.display('markerarray') }));
vi.mock('./PoseStampedDisplay', () => ({ PoseStampedDisplay: mocks.display('posestamped') }));
vi.mock('./CameraInfoDisplay', () => ({ CameraInfoDisplay: mocks.display('camerainfo') }));

import { DisplayHost } from './DisplayHost';

const state = (
  visualizations: VisualizationPanelState['visualizations'],
  fixedFrame = ''
): VisualizationPanelState => ({ ...DEFAULT_VISUALIZATION_STATE, visualizations, fixedFrame });

const frame = (parentFrame: string) => ({
  parentFrame,
  transform: { translation: new THREE.Vector3(), rotation: new THREE.Quaternion() },
  isStatic: false,
});

const makeHost = (onTfChanged?: () => void) =>
  new DisplayHost({
    ros: {} as Ros,
    root: new THREE.Group(),
    meshResourcesBaseUrl: '/mesh',
    onTfChanged,
  });

const push = (transforms: Record<string, ReturnType<typeof frame>>) =>
  mocks.listener?.({ transforms, changedFrames: new Set(Object.keys(transforms)) });

beforeEach(() => {
  mocks.created.length = 0;
  vi.clearAllMocks();
});

describe('DisplayHost reconciliation', () => {
  it('builds a display for each configured layer and ignores unusable ones', () => {
    const host = makeHost();
    host.setState(
      state([
        { id: 'a', type: 'urdf', topic: '/robot_description' },
        { id: 'b', type: 'laserscan', topic: '/scan' },
        { id: 'c', type: 'pointcloud', topic: '' },
        { id: 'd', type: 'nonsense', topic: '/x' },
      ])
    );
    expect(mocks.created.map(entry => entry.layerId)).toEqual(['a', 'b']);
  });

  it('leaves unchanged layers alone and rebuilds only the one whose options changed', () => {
    const host = makeHost();
    const urdf = { id: 'a', type: 'urdf', topic: '/robot_description' };
    host.setState(state([urdf, { id: 'b', type: 'markerarray', topic: '/m', options: { scale: 1 } }]));
    host.setState(state([urdf, { id: 'b', type: 'markerarray', topic: '/m', options: { scale: 2 } }]));

    expect(mocks.created.map(entry => entry.layerId)).toEqual(['a', 'b', 'b']);
    expect(mocks.created[0].dispose).not.toHaveBeenCalled();
    expect(mocks.created[1].dispose).toHaveBeenCalledOnce();
  });

  it('disposes a layer that is removed', () => {
    const host = makeHost();
    host.setState(state([{ id: 'a', type: 'urdf', topic: '/robot_description' }]));
    host.setState(state([]));
    expect(mocks.created[0].dispose).toHaveBeenCalledOnce();
  });

  it('rebuilds point layers, and only those, when the fixed frame changes', () => {
    const onTfChanged = vi.fn();
    const host = makeHost(onTfChanged);
    host.setState(
      state(
        [
          { id: 'cloud', type: 'pointcloud', topic: '/points' },
          { id: 'robot', type: 'urdf', topic: '/robot_description' },
        ],
        'odom'
      )
    );
    expect(host.fixedFrame).toBe('odom');

    push({ base_link: frame('odom') });
    expect(created('cloud')).toBe(1);

    host.setState(
      state(
        [
          { id: 'cloud', type: 'pointcloud', topic: '/points' },
          { id: 'robot', type: 'urdf', topic: '/robot_description' },
        ],
        'base_link'
      )
    );
    expect(host.fixedFrame).toBe('base_link');
    expect(created('cloud')).toBe(2);
    expect(created('robot')).toBe(1);
    expect(onTfChanged).toHaveBeenCalled();
  });

  it('lists frames as they appear and reports structural changes', () => {
    const onTfChanged = vi.fn();
    const host = makeHost(onTfChanged);
    host.setState(state([]));
    push({ base_link: frame('odom') });
    expect(host.frameNames).toEqual(expect.arrayContaining(['odom', 'base_link']));
    expect(onTfChanged).toHaveBeenCalled();
  });

  it('releases the shared TF subscription and every display on dispose, once', () => {
    const host = makeHost();
    host.setState(state([{ id: 'a', type: 'urdf', topic: '/robot_description' }]));
    host.dispose();
    host.dispose();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.created[0].dispose).toHaveBeenCalledOnce();
    expect(mocks.tf.dispose).toHaveBeenCalledOnce();

    host.setState(state([{ id: 'b', type: 'urdf', topic: '/x' }]));
    expect(mocks.created).toHaveLength(1);
  });
});

function created(layerId: string): number {
  return mocks.created.filter(entry => entry.layerId === layerId).length;
}
