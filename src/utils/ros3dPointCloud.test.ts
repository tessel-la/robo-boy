import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import type { CustomTFProvider } from './tfUtils';
import { PointCloud2 } from './ros3d';

const topic = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('roslib', () => ({
  Topic: vi.fn(function () {
    return topic;
  }),
}));

describe('live ROS3D PointCloud2', () => {
  let client: PointCloud2;
  let requestRender: ReturnType<typeof vi.fn>;
  let lookupTransform: ReturnType<typeof vi.fn>;
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
    requestRender = vi.fn();
    lookupTransform = vi.fn(() => ({
      translation: new THREE.Vector3(4, 5, 6),
      rotation: new THREE.Quaternion(),
    }));
    client = new PointCloud2({
      ros: {} as Ros,
      topic: '/points',
      tfClient: { lookupTransform } as unknown as CustomTFProvider,
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
    vi.unstubAllGlobals();
  });

  const cloud = (data: ArrayBuffer | Uint8Array | string) => ({
    header: { frame_id: '/camera' },
    width: 2,
    height: 1,
    point_step: 12,
    fields: [
      { name: 'x', offset: 0 },
      { name: 'y', offset: 4 },
      { name: 'z', offset: 8 },
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
      expect(requestRender).toHaveBeenCalledOnce();
    }
  );

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
    expect(client.points.material.size).toBe(0.2);
    expect(client.points.material.color.getHex()).toBe(0xff0000);
    expect(requestRender).toHaveBeenCalledOnce();
  });

  it('releases the subscription and transform frame without double-unsubscribing', () => {
    expect(scheduledFrames.size).toBe(1);
    client.unsubscribe();
    expect(topic.unsubscribe).toHaveBeenCalledOnce();
    expect(scheduledFrames.size).toBe(0);
    client.unsubscribe();
    expect(topic.unsubscribe).toHaveBeenCalledOnce();
  });
});
