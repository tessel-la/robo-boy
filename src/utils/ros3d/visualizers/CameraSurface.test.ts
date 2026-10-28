import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { cameraSurfaces, CameraSurfaceProjection } from './CameraSurface';
import { cameraClipMatrix } from '../../images/cameraProjectionMatrix';
import { cameraPlaneCorners, parseCameraInfo } from '../../images/cameraCalibration';
const calibration = parseCameraInfo({
  header: { frame_id: 'camera' },
  width: 640,
  height: 480,
  k: [300, 0, 270, 0, 350, 210, 0, 0, 1],
});
it('projects asymmetric calibrated rays to the correct corners independently of plane distance', () => {
  for (const distance of [0.1, 1, 7]) {
    const corners = cameraPlaneCorners(calibration, 640, 480, 'raw', distance);
    const matrix = cameraClipMatrix(corners, 0.01, 20);
    for (const [index, xy] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].entries()) {
      const p = new THREE.Vector3(...(corners[index] as [number, number, number])).applyMatrix4(matrix);
      expect(p.x).toBeCloseTo(xy[0]);
      expect(p.y).toBeCloseTo(xy[1]);
      expect(p.z).toBeGreaterThan(-1);
      expect(p.z).toBeLessThan(1);
    }
    expect(new THREE.Vector4(0, 0, -1, 1).applyMatrix4(matrix).w).toBeLessThan(0);
  }
});
it('honors rectification rotations rather than assuming symmetric pinhole rays', () => {
  const angle = 0.2,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const rectified = {
    ...calibration,
    r: [c, 0, s, 0, 1, 0, -s, 0, c],
    p: [300, 0, 270, -50, 0, 350, 210, 0, 0, 0, 1, 0],
  };
  const corners = cameraPlaneCorners(rectified, 640, 480, 'rectified', 1);
  const matrix = cameraClipMatrix(corners, 0.01, 20);
  expect(
    new THREE.Vector3(...(corners[0] as [number, number, number])).applyMatrix4(matrix).toArray().slice(0, 2)
  ).toEqual(expect.arrayContaining([expect.closeTo(-1), expect.closeTo(1)]));
});
it('only includes visible, explicitly owned mesh surfaces and preserves link identity', () => {
  const scene = new THREE.Scene(),
    layer = new THREE.Group(),
    link = new THREE.Group();
  layer.userData.projectionLayer = 'robot';
  link.userData.projectionFrame = 'base';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(layer);
  layer.add(link);
  link.add(mesh);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  expect(cameraSurfaces(scene)).toEqual([{ mesh, layer: 'robot', frame: link }]);
  layer.visible = false;
  expect(cameraSurfaces(scene)).toEqual([]);
});
it('fails visibly without targets or image timestamps and never changes the source mesh material', () => {
  const report = vi.fn(),
    remove = vi.fn();
  const viewer = { addOverlay: vi.fn(() => remove), requestRender: vi.fn() } as any;
  const source = {
    object: { visible: true },
    getSnapshot: () => ({ displayed: { frame: { header: { stamp: { sec: 0, nanosec: 0 } } } } }),
  } as any;
  const projection = new CameraSurfaceProjection(viewer, source, {} as any, report);
  projection.updateOptions({ renderMode: 'surfaces' });
  projection.render();
  expect(report).toHaveBeenLastCalledWith(expect.stringContaining('Select'));
  projection.updateOptions({ renderMode: 'surfaces', surfaceTargets: ['robot'], surfaceTiming: 'image' });
  projection.render();
  expect(report).toHaveBeenLastCalledWith(expect.stringContaining('acquisition timestamp'));
  projection.dispose();
  projection.dispose();
  expect(remove).toHaveBeenCalledOnce();
});

it('uses receiving-link TF at acquisition time while the textured link moves, and caches unchanged occlusion', async () => {
  const scene = new THREE.Scene(),
    link = new THREE.Group();
  link.userData.projectionLayer = 'robot';
  link.userData.projectionFrame = 'link';
  link.position.x = 10;
  const original = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(new THREE.BoxGeometry(), original);
  mesh.position.x = 1;
  link.add(mesh);
  scene.add(link);
  scene.updateMatrixWorld(true);
  const originalDispose = vi.spyOn(original, 'dispose');
  const renderer = {
    capabilities: { maxTextureSize: 2048 },
    autoClear: true,
    render: vi.fn(),
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    getViewport: (value: THREE.Vector4) => value.set(0, 0, 640, 480),
    getScissor: (value: THREE.Vector4) => value.set(0, 0, 640, 480),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    getScissorTest: () => false,
    setScissorTest: vi.fn(),
  };
  const viewer = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer,
    addOverlay: () => () => {},
    requestRender: vi.fn(),
  } as any;
  const stop = vi.fn();
  const watchTransforms = vi.fn((requests, callback) => {
    expect(requests).toEqual([{ frameId: 'link', stamp: 2_000_000_000n }]);
    callback([
      { transform: { translation: new THREE.Vector3(5, 0, 0), rotation: new THREE.Quaternion() }, error: null },
    ]);
    return stop;
  });
  const snapshot = {
    frame: { header: { stamp: { sec: 2, nanosec: 0 } } },
    position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    fixedFrame: 'map',
    corners: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  };
  const source = {
    object: { visible: true },
    plane: { material: { map: new THREE.Texture() } },
    getSnapshot: () => ({ displayed: snapshot }),
  } as any;
  const projection = new CameraSurfaceProjection(viewer, source, { watchTransforms } as any, vi.fn());
  projection.updateOptions({ renderMode: 'surfaces', surfaceTargets: ['robot'], surfaceTiming: 'image' });
  projection.render();
  await Promise.resolve();
  const depth = renderer.render.mock.calls[0][0].children[0] as THREE.Mesh;
  const overlay = renderer.render.mock.calls[1][0].children[0] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  expect(depth.matrix.elements[12]).toBe(6);
  expect(overlay.matrix.elements[12]).toBe(11);
  expect(overlay.material.uniforms.imageWorld.value.elements[12]).toBe(6);
  link.position.x = 20;
  scene.updateMatrixWorld(true);
  projection.render();
  expect(overlay.matrix.elements[12]).toBe(21);
  expect(overlay.material.uniforms.imageWorld.value.elements[12]).toBe(6);
  expect(renderer.render).toHaveBeenCalledTimes(3); // second frame needs only the overlay
  expect(stop).toHaveBeenCalledOnce();
  expect(watchTransforms).toHaveBeenCalledOnce();
  projection.dispose();
  expect(originalDispose).not.toHaveBeenCalled();
  mesh.geometry.dispose();
  original.dispose();
  source.plane.material.map.dispose();
});
