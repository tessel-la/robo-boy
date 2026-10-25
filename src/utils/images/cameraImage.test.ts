import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import { CameraImageClient } from '../ros3d/visualizers/CameraImage';
import { CustomTFProvider } from '../tfUtils';
import { TfHistory } from '../tfHistory';
import { subscribeToImages } from './cameraStreams';
import { decodeImageFrame } from './decodeImage';
import { messageBytes, rawImageToRgba } from './imageFrames';

const subscriptions = vi.hoisted(
  () => [] as { name: string; ros: Ros; receive: (message: any) => void; unsubscribe: ReturnType<typeof vi.fn> }[]
);
vi.mock('roslib', () => ({
  Topic: vi.fn(function (options: { name: string; ros: Ros }) {
    const topic = {
      ...options,
      receive: (_message: any) => {},
      subscribe: (cb: (message: any) => void) => {
        topic.receive = cb;
      },
      unsubscribe: vi.fn(),
    };
    subscriptions.push(topic);
    return topic;
  }),
}));
const header = (sec = 2, frame_id = 'optical') => ({ frame_id, stamp: { sec, nanosec: 0 } });
const info = (sec = 2) => ({
  header: header(sec),
  width: 2,
  height: 2,
  k: [2, 0, 1, 0, 2, 1, 0, 0, 1],
  p: [2, 0, 1, 0, 0, 2, 1, 0, 0, 0, 1, 0],
  d: [],
});
const image = (sec = 2) => ({
  header: header(sec),
  width: 2,
  height: 2,
  encoding: 'rgb8',
  step: 8,
  data: [255, 0, 0, 0, 255, 0, 99, 99, 0, 0, 255, 255, 255, 255, 99, 99],
});
const png = () => {
  const bytes = new Uint8Array(24);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x89504e47);
  v.setUint32(4, 0x0d0a1a0a);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, 2);
  v.setUint32(20, 2);
  return bytes;
};
let ros: Ros, root: THREE.Group, history: TfHistory, tfClient: CustomTFProvider;
let clients: CameraImageClient[], stops: (() => void)[];
const status = vi.fn(),
  render = vi.fn();
const bitmap = () => ({ width: 2, height: 2, close: vi.fn() }) as unknown as ImageBitmap;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  subscriptions.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap())
  );
  ros = {} as Ros;
  root = new THREE.Group();
  history = new TfHistory();
  tfClient = new CustomTFProvider('map', {}, history);
  clients = [];
  stops = [];
});
afterEach(() => {
  clients.forEach(c => c.dispose());
  stops.forEach(s => s());
  tfClient.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const receive = (topic: string, message: any, source = ros) =>
  subscriptions.find(item => item.name === topic && item.ros === source)!.receive(message);
const flush = async () => {
  await vi.advanceTimersByTimeAsync(5);
};
const make = (extra = {}) => {
  const c = new CameraImageClient({
    ros,
    topic: '/cam/image_raw',
    messageType: 'sensor_msgs/Image',
    tfClient,
    rootObject: root,
    onStatus: status,
    requestRender: render,
    options: { cameraInfoTopic: '/cam/camera_info' },
    ...extra,
  });
  clients.push(c);
  return c;
};
const tf = (sec = 0, x = 10, child_frame_id = 'optical') => ({
  transforms: [
    {
      header: header(sec, 'map'),
      child_frame_id,
      transform: { translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    },
  ],
});

it('uses image-time TF and calibration, recovers with delayed data and preserves optical coordinates/UVs', async () => {
  const c = make();
  receive('/cam/image_raw', image());
  await flush();
  expect(c.object.visible).toBe(false);
  receive('/cam/camera_info', info(1));
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('timestamp'));
  receive('/cam/camera_info', info());
  expect(c.object.visible).toBe(false);
  history.ingest(tf(1, 10), false);
  history.ingest(tf(3, 30), false);
  expect(c.object.visible).toBe(true);
  expect(c.object.position.x).toBe(20);
  expect([...c.plane.geometry.getAttribute('position').array]).toEqual([
    -0.5, -0.5, 1, 0.5, -0.5, 1, 0.5, 0.5, 1, -0.5, 0.5, 1,
  ]);
  expect([...c.plane.geometry.getAttribute('uv').array]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  expect(c.plane.material.map).toMatchObject({ flipY: false, colorSpace: THREE.SRGBColorSpace });
  expect(Array.from(c.plane.material.map!.image.data)).toEqual([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  history.ingest(tf(4, 90), false);
  expect(c.object.position.x).toBe(20);
  render.mockClear();
  history.ingest(tf(5, 3, 'unrelated'), false);
  expect(render).not.toHaveBeenCalled();
});

it('updates distance/opacity/frustum without resubscribing and reuses textures/geometries for identical calibration', async () => {
  const c = make();
  history.ingest(tf(), true);
  receive('/cam/camera_info', info(0));
  receive('/cam/image_raw', image());
  await flush();
  const texture = c.plane.material.map,
    geometry = c.plane.geometry;
  receive('/cam/image_raw', image(3));
  await flush();
  expect(c.plane.material.map).toBe(texture);
  expect(c.plane.geometry).toBe(geometry);
  c.updateOptions({ cameraInfoTopic: '/cam/camera_info', distance: 2, opacity: 0.4, showFrustum: false });
  expect(c.plane.material.opacity).toBe(0.4);
  expect(c.frustum.visible).toBe(false);
  expect(c.plane.geometry.getAttribute('position').getZ(0)).toBe(2);
  expect(subscriptions).toHaveLength(2);
  c.updateOptions({ cameraInfoTopic: '/cam/camera_info', visible: false });
  expect(c.object.visible).toBe(false);
  c.updateOptions({ cameraInfoTopic: '/cam/camera_info' });
  expect(c.object.visible).toBe(true);
});

it('shares image decoding and calibration subscriptions across independent layers', async () => {
  const a = make({ topic: '/cam/image_raw/compressed', messageType: 'sensor_msgs/CompressedImage' });
  const b = make({ topic: '/cam/image_raw/compressed', messageType: 'sensor_msgs/msg/CompressedImage' });
  history.ingest(tf(), true);
  receive('/cam/camera_info', info(0));
  receive('/cam/image_raw/compressed', { header: header(), format: 'png', data: png() });
  await flush();
  expect(subscriptions).toHaveLength(2);
  expect(createImageBitmap).toHaveBeenCalledOnce();
  expect(a.object.visible && b.object.visible).toBe(true);
  const decoded = a.plane.material.map!.image as ImageBitmap;
  a.updateOptions({ cameraInfoTopic: '/cam/camera_info', opacity: 0.2 });
  expect(b.plane.material.opacity).toBe(1);
  a.dispose();
  expect(decoded.close).not.toHaveBeenCalled();
  expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  b.dispose();
  expect(decoded.close).toHaveBeenCalledOnce();
  subscriptions.forEach(s => expect(s.unsubscribe).toHaveBeenCalledOnce());
});

it('hides bad/mismatched replacements and recovers, releasing textures and subscriptions on disposal', async () => {
  const c = make();
  history.ingest(tf(), true);
  receive('/cam/camera_info', info());
  receive('/cam/image_raw', image());
  await flush();
  const disposeTexture = vi.spyOn(c.plane.material.map!, 'dispose');
  receive('/cam/image_raw', { ...image(), data: [] });
  await flush();
  expect(c.object.visible).toBe(false);
  expect(disposeTexture).toHaveBeenCalledOnce();
  receive('/cam/image_raw', image());
  await flush();
  expect(c.object.visible).toBe(true);
  receive('/cam/camera_info', { ...info(), d: [0.1, 0, 0, 0, 0] });
  expect(c.object.visible).toBe(false);
  c.updateOptions({ cameraInfoTopic: '/cam/camera_info', imageGeometry: 'rectified' });
  expect(c.object.visible).toBe(true);
  receive('/cam/camera_info', { ...info(), header: header(2, 'wrong') });
  expect(c.object.visible).toBe(false);
  receive('/cam/camera_info', info());
  expect(c.object.visible).toBe(true);
  const disposeGeometry = vi.spyOn(c.plane.geometry, 'dispose');
  c.dispose();
  c.dispose();
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(root.children).toHaveLength(0);
  subscriptions.forEach(s => expect(s.unsubscribe).toHaveBeenCalledOnce());
});

it('holds pixels, geometry and pose together during delayed calibration/TF, without flashing status', async () => {
  const c = make();
  history.ingest(tf(1, 10), false);
  history.ingest(tf(3, 30), false);
  receive('/cam/camera_info', info());
  receive('/cam/image_raw', image());
  await flush();
  const pixels = c.plane.material.map!.image.data;
  const geometry = c.plane.geometry;
  status.mockClear();
  render.mockClear();
  receive('/cam/image_raw', { ...image(4), data: image().data.map(() => 0) });
  await flush();
  expect(c.object.visible).toBe(true);
  expect(c.object.position.x).toBe(20);
  expect(c.plane.material.map!.image.data).toBe(pixels);
  expect(c.plane.geometry).toBe(geometry);
  receive('/cam/camera_info', { ...info(4), k: [4, 0, 1, 0, 4, 1, 0, 0, 1] });
  await vi.advanceTimersByTimeAsync(200);
  expect(status).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  expect(c.plane.geometry).toBe(geometry);
  history.ingest(tf(5, 50), false);
  expect(c.object.visible).toBe(true);
  expect(c.object.position.x).toBe(40);
  expect(c.plane.material.map!.image.data).not.toBe(pixels);
  expect(c.plane.geometry.getAttribute('position').getX(0)).toBe(-0.25);
  await vi.advanceTimersByTimeAsync(600);
  expect(status).not.toHaveBeenCalled();
});

it('keeps pending frames across newer arrivals, reports sustained waits and catches up without a backlog', async () => {
  const c = make();
  history.ingest(tf(1, 10), false);
  history.ingest(tf(3, 30), false);
  receive('/cam/camera_info', info(0));
  receive('/cam/image_raw', image());
  await flush();
  status.mockClear();
  for (let sec = 4; sec <= 10; sec++) {
    receive('/cam/image_raw', image(sec));
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(c.object.visible).toBe(true);
  expect(c.object.position.x).toBe(20);
  expect(status).toHaveBeenCalledOnce();
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('Showing last valid image (stale)'));
  // TF still lags the newest image, but completes the retained t=4 frame.
  history.ingest(tf(5, 50), false);
  expect(c.object.visible).toBe(true);
  expect(c.object.position.x).toBe(40);
  expect(status).toHaveBeenLastCalledWith(null);
  history.ingest(tf(11, 110), false);
  expect(c.object.position.x).toBe(100);
  expect(c.object.visible).toBe(true);
});

it('expires unresolvable frames, retains displayed bitmaps and releases every lease on disposal', async () => {
  const c = make({ topic: '/compressed', messageType: 'sensor_msgs/CompressedImage' });
  const decoded: ImageBitmap[] = [];
  vi.mocked(createImageBitmap).mockImplementation(async () => {
    const frame = bitmap();
    decoded.push(frame);
    return frame;
  });
  history.ingest(tf(1, 10), false);
  history.ingest(tf(3, 30), false);
  receive('/cam/camera_info', info(0));
  const send = async (sec: number) => {
    receive('/compressed', { header: header(sec), format: 'png', data: png() });
    await flush();
  };
  await send(2);
  await send(40); // Broken timestamp cannot resolve.
  await send(4);
  await send(5);
  expect(decoded[2].close).toHaveBeenCalledOnce();
  expect(decoded[0].close).not.toHaveBeenCalled(); // Held bitmap remains uploadable.
  expect(decoded[1].close).not.toHaveBeenCalled(); // One oldest pending candidate.
  // The newest candidate can complete independently of the broken timestamp.
  history.ingest(tf(6, 60), false);
  expect(c.object.position.x).toBe(50);
  expect(c.plane.material.map!.image).toBe(decoded[3]);
  expect(decoded[0].close).toHaveBeenCalledOnce();
  expect(decoded[1].close).toHaveBeenCalledOnce();
  await send(40);
  await send(8);
  await vi.advanceTimersByTimeAsync(2100);
  await send(9); // Expired oldest must no longer occupy the protected slot.
  expect(decoded[4].close).toHaveBeenCalledOnce(); // Broken timestamp expired.
  history.ingest(tf(10, 100), false);
  expect(c.object.position.x).toBe(90);
  c.dispose();
  decoded.forEach(frame => expect(frame.close).toHaveBeenCalledOnce());
  status.mockClear();
  render.mockClear();
  await vi.advanceTimersByTimeAsync(3000);
  history.ingest(tf(50), false);
  expect(status).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

it('never reuses held coordinates across fixed-frame or calibration-source changes', async () => {
  const c = make();
  history.ingest(tf(1, 10), false);
  history.ingest(tf(3, 30), false);
  receive('/cam/camera_info', info());
  receive('/cam/image_raw', image());
  await flush();
  receive('/cam/image_raw', image(4)); // Missing both calibration and TF.
  await flush();
  expect(c.object.visible).toBe(true);
  tfClient.updateFixedFrame('unknown');
  expect(c.object.visible).toBe(false);
  tfClient.updateFixedFrame('map');
  expect(c.object.visible).toBe(true);
  c.updateOptions({ cameraInfoTopic: '/other/camera_info' });
  expect(c.object.visible).toBe(false);
  expect(c.plane.material.map).toBeNull();
  receive('/other/camera_info', info(4));
  history.ingest(tf(5, 50), false);
  expect(c.object.visible).toBe(true);
  expect(c.object.position.x).toBe(40);
  receive('/cam/image_raw', image(8));
  await flush();
  c.dispose();
  status.mockClear();
  render.mockClear();
  await vi.advanceTimersByTimeAsync(3000);
  history.ingest(tf(9, 90), false);
  expect(status).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

it('locks a displayed pose against late TF revisions and ignores out-of-order images during motion', async () => {
  const c = make();
  history.ingest(tf(1, 10), false);
  history.ingest(tf(3, 30), false);
  receive('/cam/camera_info', info(0));
  receive('/cam/image_raw', image());
  await flush();
  expect(c.object.position.x).toBe(20);
  const pixels = c.plane.material.map!.image.data;
  // A refined/replaced TF bracket must not drag the already displayed image.
  history.ingest(tf(2, 200), false);
  expect(c.object.position.x).toBe(20);
  receive('/cam/camera_info', info(0));
  expect(c.object.position.x).toBe(20);
  receive('/cam/image_raw', image(1));
  await flush();
  expect(c.object.position.x).toBe(20);
  expect(c.plane.material.map!.image.data).toBe(pixels);
  receive('/cam/image_raw', image(4));
  await flush();
  history.ingest(tf(5, 50), false);
  expect(c.object.position.x).toBe(40);
});

it('keeps a wrist-camera snapshot coherent through rotated multi-link motion and staggered TF arrival', async () => {
  const c = make();
  const base = (sec: number, x: number, angle: number) => {
    const message = tf(sec, x, 'base');
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    message.transforms[0].transform.rotation = { x: q.x, y: q.y, z: q.z, w: q.w };
    return message;
  };
  const camera = tf(0, 0.2);
  camera.transforms[0].header.frame_id = 'base';
  camera.transforms[0].transform.translation.z = 0.5;
  history.ingest(camera, true);
  history.ingest(base(1, 0, 0), false);
  history.ingest(base(3, 2, Math.PI), false);
  receive('/cam/camera_info', info(0));
  receive('/cam/image_raw', image(2));
  await flush();
  expect(c.object.position.x).toBeCloseTo(1);
  expect(c.object.position.y).toBeCloseTo(0.2);
  expect(c.object.position.z).toBeCloseTo(0.5);
  const heldRotation = c.object.quaternion.clone();
  receive('/cam/image_raw', image(4));
  await flush();
  // A late TF replacement for the old image must not move its frozen snapshot.
  history.ingest(base(2, 7, 0), false);
  expect(c.object.position.x).toBeCloseTo(1);
  expect(c.object.quaternion.angleTo(heldRotation)).toBeCloseTo(0);
  // The t=4 image can replace it only once its full acquisition-time chain resolves.
  history.ingest(base(5, 4, Math.PI), false);
  expect(c.object.position.x).toBeCloseTo(2.8);
  expect(c.object.position.y).toBeCloseTo(0);
  expect(c.object.position.z).toBeCloseTo(0.5);
  expect(
    c.object.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI))
  ).toBeCloseTo(0);
});

it('bounds async decoding to one in-flight and one latest pending image, and closes late completions', async () => {
  const complete: ((bitmap: ImageBitmap) => void)[] = [];
  vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => complete.push(resolve)));
  const frames: number[] = [];
  const stop = subscribeToImages(ros, '/compressed', 'sensor_msgs/CompressedImage', event => {
    if (event.frame) frames.push((event.frame.header!.stamp as { sec: number }).sec);
  });
  stops.push(stop);
  receive('/compressed', { header: header(1), format: 'png', data: png() });
  await flush();
  for (let sec = 2; sec < 10; sec++) receive('/compressed', { header: header(sec), format: 'png', data: png() });
  expect(complete).toHaveLength(1);
  const first = bitmap();
  complete[0](first);
  await flush();
  expect(frames).toEqual([1]);
  expect(complete).toHaveLength(2);
  const second = bitmap();
  complete[1](second);
  await flush();
  expect(frames).toEqual([1, 9]);
  receive('/compressed', { header: header(11), format: 'png', data: png() });
  await flush();
  stop();
  const last = bitmap();
  complete[2](last);
  await flush();
  expect(last.close).toHaveBeenCalledOnce();
  expect(first.close).toHaveBeenCalledOnce();
  expect(second.close).toHaveBeenCalledOnce();
  expect(frames).toEqual([1, 9]);
});

it('rejects encoded image bombs and invalid raw strides/bytes before decoding or allocating large output', async () => {
  const huge = png();
  new DataView(huge.buffer).setUint32(16, 100_000);
  await expect(decodeImageFrame({ format: 'png', data: huge }, 'sensor_msgs/CompressedImage')).rejects.toThrow('limit');
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(() => messageBytes([1, -1])).toThrow('invalid bytes');
  expect(() => rawImageToRgba({ width: 1, height: 1, encoding: 'yuyv', step: 2, data: new Uint8Array(2) })).toThrow(
    'truncated'
  );
  expect(() => rawImageToRgba({ width: 1.5, height: 1, encoding: 'rgb8', step: 6, data: new Uint8Array(6) })).toThrow(
    'limit'
  );
});

it('isolates identical topics on different ROS/replay sources', async () => {
  const other = {} as Ros;
  const received = [vi.fn(), vi.fn()];
  stops.push(subscribeToImages(ros, '/image', 'sensor_msgs/Image', received[0]));
  stops.push(subscribeToImages(other, '/image', 'sensor_msgs/Image', received[1]));
  expect(subscriptions[0]).toMatchObject({ throttle_rate: 100, queue_length: 1 });
  received.forEach(fn => fn.mockClear());
  receive('/image', image());
  await flush();
  expect(received[0]).toHaveBeenCalledOnce();
  expect(received[1]).not.toHaveBeenCalled();
});
