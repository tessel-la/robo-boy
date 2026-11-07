import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import { usePoseStampedClient } from './usePoseStampedClient';
import { CustomTFProvider } from '../utils/tfUtils';
import { TfHistory } from '../utils/tfHistory';
import type { Viewer } from '../utils/ros3d';

const topics = vi.hoisted(() => [] as { receive: (message: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }[]);
vi.mock('roslib', () => ({
  Topic: vi.fn(function () {
    const topic = {
      receive: (_message: unknown) => {},
      subscribe: (callback: (message: unknown) => void) => {
        topic.receive = callback;
      },
      unsubscribe: vi.fn(),
    };
    topics.push(topic);
    return topic;
  }),
}));

const tf = (sec: number, x: number, angle = 0) => ({
  transforms: [
    {
      header: { frame_id: 'map', stamp: { sec, nanosec: 0 } },
      child_frame_id: 'camera',
      transform: {
        translation: { x, y: 0, z: 0 },
        rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle),
      },
    },
  ],
});
const pose = (sec = 2, frame_id = 'camera') => ({
  header: { frame_id, stamp: { sec, nanosec: 0 } },
  pose: { position: { x: 1, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
});

function setup(options = {}) {
  const history = new TfHistory();
  const provider = new CustomTFProvider('map', {}, history);
  const scene = new THREE.Scene();
  const requestRender = vi.fn();
  const onStatus = vi.fn();
  const viewer = {
    scene,
    addObject: (object: THREE.Object3D) => scene.add(object),
    requestRender,
  } as unknown as Viewer;
  const props = {
    ros: { isConnected: true } as Ros,
    isRosConnected: true,
    ros3dViewer: { current: viewer },
    customTFProvider: { current: provider },
    fixedFrame: 'map',
    topic: '/pose',
    options,
    onStatus,
  };
  const hook = renderHook(value => usePoseStampedClient(value), { initialProps: props });
  const receive = (message: unknown) => act(() => topics[topics.length - 1].receive(message));
  return { ...hook, history, provider, scene, onStatus, receive, requestRender, props };
}

beforeEach(() => {
  topics.length = 0;
  vi.clearAllMocks();
});
describe('PoseStamped spatial rendering', () => {
  it('composes source-frame translation and rotation with the local pose', () => {
    const s = setup();
    s.history.ingest(tf(2, 10, Math.PI / 2), false);
    s.receive(pose());
    const group = s.scene.children[0];
    expect(group.visible).toBe(true);
    const arrow = group.children[0];
    expect(arrow.position.x).toBeCloseTo(10);
    expect(arrow.position.y).toBeCloseTo(1);
    expect(
      arrow.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))
    ).toBeCloseTo(0);
    expect(s.onStatus).toHaveBeenLastCalledWith(null);
    s.unmount();
    s.provider.dispose();
  });

  it('waits for bracketed TF, then leaves the observation anchored at acquisition time', () => {
    const s = setup({ trailEnabled: true, showTrail: true });
    s.history.ingest(tf(1, 10), false);
    s.receive(pose());
    const group = s.scene.children[0];
    expect(group.visible).toBe(false);
    expect(s.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Waiting for TF'));
    act(() => s.history.ingest(tf(3, 30), false));
    expect(group.visible).toBe(true);
    expect(group.children[0].position.x).toBe(21);
    act(() => s.history.ingest(tf(4, 100), false));
    expect(group.children[0].position.x).toBe(21);
    s.receive(pose(3));
    const trail = group.children.find(child => child instanceof THREE.Line) as THREE.Line;
    expect(trail.geometry.getAttribute('position').count).toBe(2);
    expect(trail.geometry.getAttribute('position').getX(0)).toBe(21);
    s.unmount();
    s.provider.dispose();
  });

  it('supports zero stamps and reports malformed headers/poses without stale geometry', () => {
    const s = setup({ visualizationType: 'axes' });
    s.receive(pose(0, 'map'));
    expect(s.scene.children[0].visible).toBe(true);
    s.receive(pose(2, ''));
    expect(s.scene.children[0].visible).toBe(false);
    expect(s.onStatus).toHaveBeenLastCalledWith('Message frame_id is missing.');
    s.receive({ ...pose(), pose: { ...pose().pose, position: { x: Number.NaN, y: 0, z: 0 } } });
    expect(s.onStatus).toHaveBeenLastCalledWith('Pose contains invalid coordinates.');
    s.unmount();
    s.provider.dispose();
  });

  it('detaches old ROS/TF callbacks and disposes geometry across source changes', () => {
    const s = setup();
    s.history.ingest(tf(2, 10), false);
    s.receive(pose());
    const group = s.scene.children[0];
    const arrow = group.children[0];
    const geometry = (arrow.children[0] as THREE.Mesh).geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    const late = topics[0].receive;
    const nextProvider = new CustomTFProvider('map', {}, new TfHistory());
    s.rerender({ ...s.props, ros: { isConnected: true } as Ros, customTFProvider: { current: nextProvider } });
    expect(topics[0].unsubscribe).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    const next = s.scene.children[0];
    act(() => {
      late(pose());
      s.history.ingest(tf(2, 99), false);
    });
    expect(next.visible).toBe(false);
    expect(next.children).toHaveLength(0);
    s.unmount();
    expect(s.scene.children).toHaveLength(0);
    nextProvider.dispose();
    s.provider.dispose();
  });
});
