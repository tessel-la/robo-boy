import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import { PathClient } from './ros3d/visualizers/Path';
import { OccupancyGridClient } from './ros3d/visualizers/OccupancyGrid';
import { CustomTFProvider } from './tfUtils';
import { TfHistory } from './tfHistory';

const topics = vi.hoisted(() => [] as { receive: (value: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }[]);
vi.mock('roslib', async importOriginal => {
  const actual = await importOriginal<typeof import('roslib')>();
  const Topic = vi.fn(function () {
    const topic = {
      receive: (_value: unknown) => {},
      subscribe: (cb: (value: unknown) => void) => {
        topic.receive = cb;
      },
      unsubscribe: vi.fn(),
    };
    topics.push(topic);
    return topic;
  });
  return { ...actual, default: { ...actual.default, Topic }, Topic };
});

const header = (frame_id = 'map', sec = 2) => ({ frame_id, stamp: { sec, nanosec: 0 } });
const path = (frame = 'map') => ({
  header: header(frame),
  poses: [0, 1, 2].map(x => ({ pose: { position: { x, y: 1, z: 0.1 } } })),
});
const grid = (frame = 'map') => ({
  header: header(frame),
  info: {
    width: 2,
    height: 1,
    resolution: 0.5,
    origin: { position: { x: 3, y: 4, z: 0 }, orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } },
  },
  data: [0, 100],
});
const tf = (sec: number, x: number) => ({
  transforms: [
    {
      header: header('map', sec),
      child_frame_id: 'odom',
      transform: { translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    },
  ],
});

let history: TfHistory, provider: CustomTFProvider, root: THREE.Group;
let clients: (PathClient | OccupancyGridClient)[];
const status = vi.fn();
const render = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  topics.length = 0;
  clients = [];
  history = new TfHistory();
  provider = new CustomTFProvider('map', {}, history);
  root = new THREE.Group();
});
afterEach(() => {
  clients.forEach(client => client.dispose());
  provider.dispose();
});
const config = (topic: string) => ({
  ros: {} as Ros,
  topic,
  tfClient: provider,
  rootObject: root,
  requestRender: render,
  onStatus: status,
});
const makePath = () => {
  const c = new PathClient(config('/robot/plan'));
  clients.push(c);
  return c;
};
const makeGrid = () => {
  const c = new OccupancyGridClient(config('/robot/map'));
  clients.push(c);
  return c;
};

describe('navigation layer clients', () => {
  it('transforms path points at acquisition time, recovers with delayed TF and uses world-space line width', () => {
    const client = makePath();
    const watch = vi.spyOn(provider, 'watchTransforms');
    topics[0].receive(path('odom'));
    expect(client.object.visible).toBe(false);
    history.ingest(tf(1, 10), false);
    history.ingest(tf(3, 30), false);
    expect(client.object.visible).toBe(true);
    expect(client.object.geometry.getAttribute('instanceStart').getX(0)).toBe(20);
    history.ingest(tf(4, 99), false);
    expect(client.object.geometry.getAttribute('instanceStart').getX(0)).toBe(20);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch.mock.calls[0][0]).toHaveLength(1);
    expect(client.object.material.worldUnits).toBe(true);
    const geometry = client.object.geometry;
    client.updateOptions({ color: '#ff0000', lineWidth: 0.12, opacity: 0.4, visible: false });
    expect(client.object.geometry).toBe(geometry);
    expect(client.object.material.color.getHexString()).toBe('ff0000');
    expect(client.object.material.linewidth).toBe(0.12);
    expect(client.object.material.opacity).toBe(0.4);
    expect(client.object.visible).toBe(false);
    client.updateOptions({ visible: true });
    expect(client.object.visible).toBe(true);
    expect(topics).toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith(null);
  });

  it('honors differing pose frames/times and hides the entire path until every transform resolves', () => {
    const client = makePath();
    const message = path();
    (message.poses[1] as any).header = header('odom', 3);
    topics[0].receive(message);
    expect(client.object.visible).toBe(false);
    history.ingest(tf(3, 7), false);
    expect(client.object.visible).toBe(true);
    expect(client.object.geometry.getAttribute('instanceStart').getX(0)).toBe(0);
    expect(client.object.geometry.getAttribute('instanceEnd').getX(0)).toBe(8);
    provider.updateFixedFrame('odom');
    expect(client.object.visible).toBe(false); // map-frame points need TF at t=2 too.
    history.ingest(tf(1, 5), false);
    expect(client.object.visible).toBe(true);
    expect(client.object.geometry.getAttribute('instanceStart').getX(0)).toBe(-6);
  });

  it('clears empty/malformed paths, detaches replaced TF listeners and disposes GPU data on removal', () => {
    const client = makePath();
    topics[0].receive(path());
    const dispose = vi.spyOn(client.object.geometry, 'dispose');
    topics[0].receive({ poses: [] });
    expect(dispose).toHaveBeenCalledOnce();
    expect(client.object.visible).toBe(false);
    history.ingest(tf(2, 99), false);
    expect(client.object.visible).toBe(false);
    topics[0].receive({ poses: [null] });
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('coordinates'));
    const material = vi.spyOn(client.object.material, 'dispose');
    client.dispose();
    client.dispose();
    expect(material).toHaveBeenCalledOnce();
    expect(topics[0].unsubscribe).toHaveBeenCalledOnce();
    topics[0].receive(path());
    expect(root.children).toHaveLength(0);
  });

  it('places map cell corners with origin rotation, resolution and TF, preserving row order and nearest sampling', () => {
    const client = makeGrid();
    topics[0].receive(grid('odom'));
    expect(client.object.visible).toBe(false);
    history.ingest(tf(2, 10), false);
    expect(client.object.visible).toBe(true);
    const mesh = client.object.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    root.updateMatrixWorld(true);
    const firstCellCorner = mesh.localToWorld(new THREE.Vector3(0, 0, 0));
    const farCorner = mesh.localToWorld(new THREE.Vector3(1, 0.5, 0));
    expect(firstCellCorner.toArray()).toEqual([13, 4, 0]);
    expect(farCorner.x).toBeCloseTo(12.5);
    expect(farCorner.y).toBeCloseTo(5);
    expect(mesh.material.map).toMatchObject({ flipY: false, minFilter: THREE.NearestFilter, generateMipmaps: false });
    expect(mesh.material.opacity).toBe(0.7);
    client.updateOptions({ opacity: 0, visible: false });
    expect(mesh.material.opacity).toBe(0);
    expect(client.object.visible).toBe(false);
    client.updateOptions({ opacity: 0.5 });
    expect(client.object.visible).toBe(true);
    expect(topics).toHaveLength(1);
  });

  it('replaces resized/moved maps, releases old textures and clears malformed/empty grids', () => {
    const client = makeGrid();
    topics[0].receive(grid());
    const mesh = client.object.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const texture = vi.spyOn(mesh.material.map!, 'dispose');
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const material = vi.spyOn(mesh.material, 'dispose');
    topics[0].receive({ ...grid(), info: { ...grid().info, width: 1, height: 2, resolution: 1 } });
    expect(texture).toHaveBeenCalledOnce();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(client.object.children).toHaveLength(1);
    topics[0].receive({ ...grid(), data: [3] });
    expect(client.object.visible).toBe(false);
    expect(client.object.children).toHaveLength(0);
    history.ingest(tf(2, 10), false);
    expect(client.object.visible).toBe(false);
    topics[0].receive({ info: { width: 0, height: 0 }, data: [] });
    expect(status).toHaveBeenLastCalledWith(null);
    client.dispose();
    topics[0].receive(grid());
    expect(root.children).toHaveLength(0);
    expect(topics[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps simultaneous maps/paths independent', () => {
    const a = makePath(),
      b = makePath(),
      map = makeGrid();
    topics[0].receive(path());
    topics[1].receive(path());
    topics[2].receive(grid());
    a.updateOptions({ opacity: 0.2, visible: false });
    map.updateOptions({ visible: false });
    expect(a.object.material.opacity).toBe(0.2);
    expect(b.object.material.opacity).toBe(1);
    expect(b.object.visible).toBe(true);
    expect(root.children).toHaveLength(3);
  });

  it('does not redraw unchanged navigation layers on unrelated TF traffic', () => {
    makePath();
    makeGrid();
    topics[0].receive(path());
    topics[1].receive(grid());
    render.mockClear();
    history.ingest(tf(3, 20), false);
    expect(render).not.toHaveBeenCalled();
  });
});

it('updates map cells and palettes in place, resynchronizes invalid patches, and releases both subscriptions', () => {
  const client = new OccupancyGridClient({
    ...config('/map'),
    options: { updatesTopic: '/map_updates', palette: 'costmap' },
  });
  clients.push(client);
  // Updates subscribe first; no patch can establish an initial map.
  topics[1].receive({ header: header(), x: 0, y: 0, width: 1, height: 1, data: [100] });
  expect(client.object.visible).toBe(false);
  topics[0].receive(grid());
  const mesh = client.object.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  const texture = mesh.material.map!;
  const geometry = mesh.geometry;
  topics[1].receive({ header: header('map', 3), x: 0, y: 0, width: 1, height: 1, data: [99] });
  expect(client.object.children[0]).toBe(mesh);
  expect(mesh.geometry).toBe(geometry);
  expect([...texture.image.data.slice(0, 4)]).toEqual([0, 255, 255, 255]);
  client.updateOptions({ updatesTopic: '/map_updates', palette: 'occupancy' });
  expect(client.object.children[0]).toBe(mesh);
  expect([...texture.image.data.slice(0, 4)]).toEqual([3, 3, 3, 255]);
  expect(topics).toHaveLength(2);
  topics[1].receive({ header: header('map', 4), x: 2, y: 0, width: 1, height: 1, data: [100] });
  expect(client.object.visible).toBe(false);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('fresh full map'));
  expect(topics[0].unsubscribe).toHaveBeenCalledOnce();
  topics[1].receive({ header: header('map', 5), x: 0, y: 0, width: 1, height: 1, data: [100] });
  expect(client.object.children).toHaveLength(0);
  topics[0].receive(grid()); // A retained snapshot from before the gap cannot repair it.
  expect(client.object.visible).toBe(false);
  topics[0].receive({ ...grid(), header: header('map', 6) });
  expect(client.object.visible).toBe(true);
  client.dispose();
  expect(topics[1].unsubscribe).toHaveBeenCalledOnce();
});

it('moves rolling map origins without reallocating the texture and resets patch sequence on a fresh full map', () => {
  const client = new OccupancyGridClient({ ...config('/map'), options: { updatesTopic: '/map_updates' } });
  clients.push(client);
  topics[0].receive(grid());
  const mesh = client.object.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  const texture = mesh.material.map!;
  topics[1].receive({ header: header('map', 3), x: 0, y: 0, width: 1, height: 1, data: [50] });
  const moved = grid();
  moved.info.origin.position.x = 10;
  topics[0].receive({ ...moved, header: header('map', 4) });
  expect(client.object.children[0]).toBe(mesh);
  expect(mesh.material.map).toBe(texture);
  expect(mesh.position.x).toBe(10);
  topics[1].receive({ header: header('map', 3), x: 0, y: 0, width: 1, height: 1, data: [100] });
  expect([...texture.image.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
});

it('invalidates the full-map baseline on disconnect and ignores updates until a new snapshot', () => {
  const events = new Map<string, () => void>();
  const off = vi.fn();
  const ros = { on: (name: string, fn: () => void) => events.set(name, fn), off } as unknown as Ros;
  const client = new OccupancyGridClient({ ...config('/map'), ros, options: { updatesTopic: '/map_updates' } });
  clients.push(client);
  topics[0].receive(grid());
  expect(client.object.visible).toBe(true);
  events.get('close')!();
  expect(client.object.visible).toBe(false);
  topics[1].receive({ header: header('map', 3), x: 0, y: 0, width: 1, height: 1, data: [100] });
  expect(client.object.children).toHaveLength(0);
  topics[0].receive({ ...grid(), header: header('map', 4) });
  expect(client.object.visible).toBe(true);
  client.dispose();
  expect(off).toHaveBeenCalledWith('close', expect.any(Function));
});

it('keeps global and local costmap update chains independent', () => {
  const global = new OccupancyGridClient({
    ...config('/global/costmap'),
    options: { updatesTopic: '/global/costmap_updates', palette: 'costmap' },
  });
  const local = new OccupancyGridClient({
    ...config('/local/costmap'),
    options: { updatesTopic: '/local/costmap_updates', palette: 'costmap' },
  });
  clients.push(global, local);
  topics[0].receive(grid());
  topics[2].receive(grid());
  const globalTexture = (global.object.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material
    .map!;
  const localTexture = (local.object.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material
    .map!;
  topics[1].receive({ header: header('map', 3), x: 0, y: 0, width: 1, height: 1, data: [100] });
  expect([...globalTexture.image.data.slice(0, 4)]).toEqual([255, 0, 255, 255]);
  expect([...localTexture.image.data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  global.dispose();
  expect(topics[3].unsubscribe).not.toHaveBeenCalled();
  topics[3].receive({ header: header('map', 4), x: 0, y: 0, width: 1, height: 1, data: [99] });
  expect([...localTexture.image.data.slice(0, 4)]).toEqual([0, 255, 255, 255]);
});
