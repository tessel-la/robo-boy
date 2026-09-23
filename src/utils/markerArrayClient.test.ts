import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MarkerArrayClient } from './markerArrayClient';

vi.mock('roslib', () => ({ default: { Topic: vi.fn(function () {
  return { subscribe: vi.fn(), unsubscribe: vi.fn() };
}) } }));

const marker = (id = 1): any => ({ ns: 'objects', id, type: 10, action: 0,
  header: { frame_id: `pcb_${id}` }, frame_locked: true,
  mesh_resource: 'package://models/pcb.obj', mesh_use_embedded_materials: true,
  pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  scale: { x: 1, y: 1, z: 1 }, color: { r: 1, g: 1, b: 1, a: 1 } });

function setup(load?: () => Promise<THREE.Object3D>) {
  const callbacks = new Map<string, (tf: any) => void>();
  const tfClient = { subscribe: vi.fn((frame, cb) => { callbacks.set(frame, cb); cb(null); }),
    unsubscribe: vi.fn((frame) => callbacks.delete(frame)) };
  const root = new THREE.Group();
  const loadMesh = vi.fn(load ?? (async () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())));
  const client = new MarkerArrayClient({ ros: {} as any, topic: '/objects', tfClient: tfClient as any,
    rootObject: root, path: '/meshes', requestRender: vi.fn(), loadMesh });
  return { client, root, callbacks, loadMesh, tfClient };
}

describe('mesh marker inventory', () => {
  it('follows existing TF, reuses geometry, and reconciles retained snapshots without blinking', async () => {
    const { client, root, callbacks, loadMesh } = setup();
    client.receive({ markers: [{ action: 3 } as any, marker()] });
    await Promise.resolve();
    const first = root.children[0];
    const mesh = first.children[0].children[0] as THREE.Mesh;
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(first.visible).toBe(false);
    callbacks.get('pcb_1')!({ translation: { x: 2, y: 3, z: 4 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    expect(first.visible).toBe(true);
    expect(first.position.toArray()).toEqual([2, 3, 4]);
    client.receive({ markers: [{ action: 3 } as any, marker(), marker(2)] });
    await Promise.resolve();
    expect(root.children[0]).toBe(first);
    expect(loadMesh).toHaveBeenCalledTimes(1);
    callbacks.get('pcb_1')!({ translation: { x: 5, y: 3, z: 4 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    expect(first.position.x).toBe(5);
    client.receive({ markers: [{ ns: 'objects', id: 1, action: 2 } as any] });
    expect(root.children).toHaveLength(1);
    expect(callbacks.has('pcb_1')).toBe(false);
    client.receive({ markers: [{ action: 3 } as any] });
    expect(root.children).toHaveLength(0);
    client.dispose();
  });

  it('does not resurrect removed objects when asynchronous loading completes', async () => {
    let complete!: (object: THREE.Object3D) => void;
    const { client, root, tfClient } = setup(() => new Promise(resolve => { complete = resolve; }));
    client.receive({ markers: [marker()] });
    client.receive({ markers: [{ action: 3 } as any] });
    complete(new THREE.Group());
    await Promise.resolve();
    expect(root.children).toHaveLength(0);
    expect(tfClient.unsubscribe).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('expires markers and unsubscribes their TF callbacks', async () => {
    vi.useFakeTimers();
    const { client, root, callbacks } = setup();
    client.receive({ markers: [{ ...marker(), lifetime: { sec: 1, nanosec: 0 } }] });
    await Promise.resolve();
    vi.advanceTimersByTime(1001);
    expect(root.children).toHaveLength(0);
    expect(callbacks.size).toBe(0);
    client.dispose();
    vi.useRealTimers();
  });
});
