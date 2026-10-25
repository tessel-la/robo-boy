import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import { CustomTFProvider } from './tfUtils';
import { TfHistory } from './tfHistory';
import { PointCloud2 } from './ros3d';

const topic = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('roslib', () => ({
  Topic: vi.fn(function () {
    return topic;
  }),
}));

describe('live ROS3D PointCloud2', () => {
  let client: PointCloud2;
  let requestRender = vi.fn(() => {});
  let lookupTransform: ReturnType<typeof vi.spyOn>;
  let provider: CustomTFProvider;
  let history: TfHistory;
  const onStatus = vi.fn();
  let scheduledFrames: Map<number, FrameRequestCallback>;
  let message: (value: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduledFrames = new Map();
    let nextFrame = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrames.set(++nextFrame, callback);
        return nextFrame;
      })
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => scheduledFrames.delete(id))
    );
    requestRender = vi.fn(() => {});
    history = new TfHistory();
    provider = new CustomTFProvider('map', { camera: { parentFrame: 'map', isStatic: false,
      transform: { translation: new THREE.Vector3(4, 5, 6), rotation: new THREE.Quaternion() } } }, history);
    lookupTransform = vi.spyOn(provider, 'lookupTransform');
    client = new PointCloud2({
      ros: {} as Ros,
      topic: '/points',
      tfClient: provider,
      onStatus,
      rootObject: new THREE.Group(),
      max_pts: 1,
      fixedFrame: 'map',
      requestRender,
    });
    message = topic.subscribe.mock.calls[0][0];
  });

  afterEach(() => {
    client.unsubscribe();
    client.points.geometry.dispose();
    client.points.material.dispose();
    provider.dispose();
    vi.unstubAllGlobals();
  });

  const cloud = (data: ArrayBuffer | Uint8Array | string) => ({
    header: { frame_id: '/camera' },
    width: 2,
    height: 1,
    point_step: 12,
    row_step: 24,
    fields: [
      { name: 'x', offset: 0, datatype: 7, count: 1 },
      { name: 'y', offset: 4, datatype: 7, count: 1 },
      { name: 'z', offset: 8, datatype: 7, count: 1 },
    ],
    data,
  });

  it.each(['buffer', 'view', 'base64'])(
    'decodes %s data, caps points, transforms frames, and requests rendering',
    format => {
      const data = new Float32Array([1, 2, 3, 9, 9, 9]);
      const padded = new Uint8Array(data.byteLength + 8);
      padded.set(new Uint8Array(data.buffer), 4);
      const payload =
        format === 'view'
          ? padded.subarray(4, 4 + data.byteLength)
          : format === 'base64'
            ? btoa(String.fromCharCode(...new Uint8Array(data.buffer)))
            : data.buffer;
      message(cloud(payload));
      expect([...client.points.geometry.getAttribute('position').array]).toEqual([1, 2, 3]);
      expect(client.points.geometry.drawRange.count).toBe(1);
      expect(lookupTransform).toHaveBeenCalledWith('map', 'camera');
      expect(client.position.toArray()).toEqual([4, 5, 6]);
      expect(client.visible).toBe(true);
      expect(requestRender).toHaveBeenCalled();
    }
  );

  it('preserves material point size and custom shaders', () => {
    const flat = new PointCloud2({ ros: {} as Ros, topic: '/other', tfClient: provider, rootObject: new THREE.Group(), material: { size: 0.25 } });
    expect((flat.points.material as THREE.PointsMaterial).size).toBe(0.25);
    flat.unsubscribe(); flat.points.geometry.dispose(); flat.points.material.dispose();
    const shader = new THREE.ShaderMaterial();
    expect(client.safeResetPoints(shader)).toBe(true);
    expect(client.points.object.material).toBe(shader);
  });

  it('applies updated scales, origins, point size, and color through the live API', () => {
    client.updateSettings({
      scaleX: 2,
      scaleY: 3,
      scaleZ: 4,
      originX: 10,
      originY: 20,
      originZ: 30,
      pointSize: 0.2,
      color: 0xff0000,
    });
    requestRender.mockClear();
    message(cloud(new Float32Array([1, 2, 3, 9, 9, 9]).buffer));
    expect([...client.points.geometry.getAttribute('position').array]).toEqual([12, 26, 42]);
    expect((client.points.material as THREE.PointsMaterial).size).toBe(0.2);
    expect((client.points.material as THREE.PointsMaterial).color.getHex()).toBe(0xff0000);
    expect(requestRender).toHaveBeenCalled();
  });

  it('anchors a delayed cloud at sensor time and waits for future TF without polling', () => {
    const tf = (sec: number, x: number) => ({ transforms: [{ header: { frame_id: 'map', stamp: { sec, nanosec: 0 } },
      child_frame_id: 'camera', transform: { translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }] });
    history.ingest(tf(1, 10), false);
    const value = { ...cloud(new Float32Array([1, 2, 3, 9, 9, 9]).buffer), header: { frame_id: 'camera', stamp: { sec: 2, nanosec: 0 } } };
    message(value);
    expect(client.visible).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Waiting for TF'));
    history.ingest(tf(3, 30), false);
    expect(client.visible).toBe(true);
    expect(client.position.x).toBe(20);
    history.ingest(tf(4, 100), false);
    expect(client.position.x).toBe(20);
    const renders = requestRender.mock.calls.length;
    client.unsubscribe();
    history.ingest(tf(2, 22), false);
    message(value);
    expect(requestRender).toHaveBeenCalledTimes(renders);
    expect(scheduledFrames.size).toBe(0);
  });

  it('hides old geometry when the new payload or frame is invalid', () => {
    message(cloud(new Float32Array([1, 2, 3, 9, 9, 9]).buffer));
    expect(client.visible).toBe(true);
    message(cloud(new Uint8Array(2)));
    expect(client.visible).toBe(false);
    expect(client.points.geometry.drawRange.count).toBe(0);
    expect(onStatus).toHaveBeenLastCalledWith('Truncated PointCloud2 data.');
    message({ ...cloud(new Float32Array(6).buffer), header: {} });
    expect(onStatus).toHaveBeenLastCalledWith('Message frame_id is missing.');
  });

  it('releases the subscription and transform frame without double-unsubscribing', () => {
    expect(scheduledFrames.size).toBe(0);
    client.unsubscribe();
    expect(topic.unsubscribe).toHaveBeenCalledOnce();
    expect(scheduledFrames.size).toBe(0);
    client.unsubscribe();
    expect(topic.unsubscribe).toHaveBeenCalledOnce();
  });
});
