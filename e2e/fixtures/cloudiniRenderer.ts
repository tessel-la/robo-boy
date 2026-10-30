import * as THREE from 'three';
import { Ros } from 'roslib';
import { PointCloud2 } from '../../src/utils/ros3d/visualizers/PointCloud2';
import { CustomTFProvider } from '../../src/utils/tfUtils';
import { TfHistory } from '../../src/utils/tfHistory';
import fixture from './cloudini-v6.json';

const wait = async (condition: () => boolean) => {
  const deadline = performance.now() + 10_000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  if (!condition()) throw new Error('Cloudini renderer did not reach the expected state.');
};
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); }
// Run as a page script: debugger evaluation itself can bypass CSP's eval restriction.
let javascriptEvalBlocked = false;
try { new Function('return 1')(); } catch { javascriptEvalBlocked = true; }

(globalThis as any).runCloudiniFixture = async () => {
  const ros = new Ros();
  const operations: unknown[] = [];
  (ros as any).callOnConnection = (message: unknown) => { operations.push(message); };
  const history = new TfHistory();
  const transform = { translation: { x: 10, y: 20, z: 30 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  history.ingest({ transforms: [{ header: { frame_id: 'map' }, child_frame_id: 'laser', transform }] }, true);
  const provider = new CustomTFProvider('map', { laser: { parentFrame: 'map', isStatic: true,
    transform: { translation: new THREE.Vector3(10, 20, 30), rotation: new THREE.Quaternion() } } }, history);
  let renders = 0, workers = 0, terminated = 0;
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers++; }
    terminate() { terminated++; super.terminate(); }
  };
  let status: string | null = null;
  const options = { ros, tfClient: provider, rootObject: new THREE.Group(), max_pts: 3,
    requestRender: () => { renders++; }, onStatus: (value: string | null) => { status = value; } };
  const raw = new PointCloud2({ ...options, topic: '/raw' });
  const compressed = new PointCloud2({ ...options, topic: '/compressed', messageType: 'point_cloud_interfaces/msg/CompressedPointCloud2' });
  try {
    ros.emit('/raw', { ...fixture, data: new Float32Array([1.1234, 2.9876, -3.5432, 4, 5, 6, NaN, 7, 8]) });
    check(workers === 0 && raw.visible && raw.points.geometry.drawRange.count === 2, 'Raw point clouds regressed.');
    ros.emit('/compressed', fixture);
    await wait(() => compressed.visible && compressed.points.geometry.drawRange.count === 2);
    const positions = [...compressed.points.geometry.getAttribute('position').array].slice(0, 6);
    const reference = raw.points.geometry.getAttribute('position').array;
    positions.forEach((value, i) => check(Math.abs(value - reference[i]) < 0.000502, 'XYZ differs from the raw renderer.'));
    check(compressed.position.equals(raw.position) && compressed.position.x === 10, 'Acquisition-time TF regressed.');
    ros.emit('/compressed', { ...fixture, width: 2, row_step: 24 });
    await wait(() => !!status?.includes('Cloudini payload'));
    check(!compressed.visible && compressed.points.geometry.drawRange.count === 0, 'Malformed payload retained stale geometry.');
    ros.emit('/compressed', fixture);
    await wait(() => compressed.visible && compressed.points.geometry.drawRange.count === 2);
    compressed.unsubscribe();
    raw.unsubscribe();
    const before = renders;
    ros.emit('/compressed', fixture);
    ros.emit('/raw', fixture);
    await new Promise(resolve => setTimeout(resolve, 30));
    check(renders === before && workers === 1 && terminated === 1, 'Point-cloud cleanup regressed.');
    return { positions, transform: compressed.position.toArray(), workers, terminated, raw_compatible: true,
      invalid_rejected: true, recovered: true, javascript_eval_blocked: javascriptEvalBlocked, operations: operations.length };
  } finally {
    compressed.unsubscribe(); raw.unsubscribe(); provider.dispose();
    for (const client of [raw, compressed]) { client.points.geometry.dispose(); client.points.material.dispose(); }
    globalThis.Worker = NativeWorker;
  }
};
