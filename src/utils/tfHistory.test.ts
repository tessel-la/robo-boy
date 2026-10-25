import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CustomTFProvider } from './tfUtils';
import { TfHistory, TF_SAMPLES_PER_FRAME, rosStamp } from './tfHistory';
import { watchMessageTransform } from './stampedTransform';

const ns = (sec: number) => BigInt(sec) * 1_000_000_000n;
const message = (child: string, parent: string, sec: number, x: number, angle = 0) => ({
  transforms: [
    {
      header: { frame_id: parent, stamp: { sec, nanosec: 0 } },
      child_frame_id: child,
      transform: {
        translation: { x, y: 0, z: 0 },
        rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle),
      },
    },
  ],
});
function x(history: TfHistory, target: string, source: string, sec: number) {
  const result = history.lookup(target, source, ns(sec));
  expect(result.error).toBe(null);
  return result.transform!.translation.x;
}

describe('acquisition-time TF history', () => {
  it('parses both ROS stamp spellings without rounding nanoseconds', () => {
    expect(rosStamp({ sec: 1_700_000_000, nanosec: 123456789 })).toBe(1700000000123456789n);
    expect(rosStamp({ secs: 1, nsecs: 2 })).toBe(1000000002n);
    expect(rosStamp(undefined)).toBe(0n);
    for (const stamp of [null, {}, { sec: -1, nanosec: 0 }, { sec: 1, nanosec: 1e9 }, { sec: 1.5, nanosec: 0 }])
      expect(rosStamp(stamp)).toBe(null);
  });

  it('interpolates translation and rotation, including out-of-order samples and inverse lookups', () => {
    const h = new TfHistory();
    h.ingest(message('base', 'map', 3, 30, Math.PI), false);
    h.ingest(message('base', 'map', 1, 10), false);
    const value = h.lookup('map', 'base', ns(2));
    expect(value.transform!.translation.x).toBe(20);
    expect(
      value.transform!.rotation.angleTo(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
      )
    ).toBeCloseTo(0);
    expect(x(h, 'base', 'map', 1)).toBe(-10);
    expect(x(h, 'map', 'base', 3)).toBe(30);
    h.ingest(message('base', 'map', 3, 33), false);
    expect(x(h, 'map', 'base', 3)).toBe(33);
  });

  it('composes rotated branches and static frames without requiring unrelated ancestors', () => {
    const h = new TfHistory();
    h.ingest(message('base', 'map', 2, 10, Math.PI / 2), false);
    h.ingest(message('camera', 'base', 0, 2), true);
    const value = h.lookup('map', 'camera', ns(2)).transform!;
    expect(value.translation.x).toBeCloseTo(10);
    expect(value.translation.y).toBeCloseTo(2);
    expect(x(h, 'base', 'camera', 100)).toBe(2);
    expect(x(h, 'camera', 'camera', 100)).toBe(0);
    h.ingest(message('other', 'map', 2, 5), false);
    const branch = h.lookup('other', 'camera', ns(2)).transform!;
    expect(branch.translation.x).toBeCloseTo(5);
    expect(branch.translation.y).toBeCloseTo(2);
  });

  it('fails closed for future/expired history, disconnected trees, reparenting and cycles', () => {
    const h = new TfHistory();
    h.source = '/roboboy/tf';
    h.ingest(message('base', 'map', 10, 1), false);
    expect(h.lookup('map', 'base', ns(9)).error).toContain('too old');
    expect(h.lookup('map', 'base', ns(11)).error).toContain('/roboboy/tf');
    expect(h.lookup('world', 'base', ns(10)).transform).toBeNull();
    h.ingest(message('base', 'world', 12, 2), false);
    expect(h.lookup('map', 'base', ns(11)).error).toContain('parent changed');
    h.ingest(message('a', 'b', 0, 1), true);
    h.ingest(message('b', 'a', 0, 1), true);
    expect(h.lookup('map', 'a', ns(10)).transform).toBeNull();
  });

  it('bounds samples by count and ROS-time age, and releases dynamic state separately', () => {
    const h = new TfHistory();
    h.ingest(message('static', 'map', 0, 4), true);
    for (let i = 1; i < TF_SAMPLES_PER_FRAME + 10; i++) {
      const m = message('base', 'map', 1, i);
      m.transforms[0].header.stamp.nanosec = i;
      h.ingest(m, false);
    }
    expect(h.lookup('map', 'base', ns(1) + 1n).error).toContain('too old');
    h.ingest(message('base', 'map', 40, 40), false);
    expect(h.lookup('map', 'base', ns(1)).error).toContain('too old');
    h.ingest(message('base', 'map', 1, -10), false);
    expect(x(h, 'map', 'base', 40)).toBe(40);
    h.clear(true);
    expect(h.lookup('map', 'base', ns(40)).transform).toBeNull();
    expect(x(h, 'map', 'static', 100)).toBe(4);
    h.clear();
    expect(h.lookup('map', 'static', ns(100)).transform).toBeNull();
  });

  it('isolates failing observers so other panels still receive shared history', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const history = new TfHistory();
    const provider = new CustomTFProvider('map', {}, history);
    // Begin throwing only after registration, like a renderer failing on incoming TF.
    let fail = false;
    const detach = provider.watchTransform('base', ns(2), () => {
      if (fail) throw new Error('render failed');
    });
    fail = true;
    const initialFailure = vi.fn(() => { throw new Error('initial render failed'); });
    expect(() => provider.watchTransform('base', ns(2), initialFailure)).toThrow('initial render failed');
    const healthy = vi.fn();
    provider.watchTransform('base', ns(2), healthy);
    history.subscribe(() => {
      throw new Error('panel failed');
    });
    const late = vi.fn();
    history.subscribe(late);
    expect(() => history.ingest(message('base', 'map', 2, 5), false)).not.toThrow();
    expect(healthy.mock.lastCall![0].transform.translation.x).toBe(5);
    expect(late).toHaveBeenCalledOnce();
    expect(initialFailure).toHaveBeenCalledOnce();
    detach();
    provider.dispose();
    errors.mockRestore();
  });

  it('retries pending lookups on new TF and frame changes, detaching on cleanup', () => {
    const h = new TfHistory(),
      provider = new CustomTFProvider('map', {}, h),
      callback = vi.fn();
    const stop = watchMessageTransform(provider, { frame_id: 'base', stamp: { sec: 2, nanosec: 0 } }, callback);
    expect(callback.mock.lastCall![0].transform).toBeNull();
    h.ingest(message('base', 'map', 2, 5), false);
    expect(callback.mock.lastCall![0].transform.translation.x).toBe(5);
    provider.updateFixedFrame('base');
    expect(callback.mock.lastCall![0].transform.translation.x).toBe(0);
    stop();
    const count = callback.mock.calls.length;
    h.ingest(message('base', 'map', 2, 7), false);
    expect(callback).toHaveBeenCalledTimes(count);
    const bad = vi.fn();
    watchMessageTransform(provider, { frame_id: 'base', stamp: {} }, bad);
    expect(bad.mock.lastCall![0].error).toContain('invalid');
    provider.dispose();
  });
});
