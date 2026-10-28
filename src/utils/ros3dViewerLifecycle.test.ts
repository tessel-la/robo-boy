import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');

  class WebGLRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: true };
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
  }

  return { ...actual, WebGLRenderer };
});

describe('ROS3D viewer render lifecycle', () => {
  let scheduledFrames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    document.body.innerHTML = '<div id="viewer"></div>';
    scheduledFrames = new Map();
    nextFrameId = 1;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId++;
        scheduledFrames.set(frameId, callback);
        return frameId;
      })
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => {
        scheduledFrames.delete(frameId);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('rejects a missing viewer container before allocating rendering resources', async () => {
    const { Viewer } = await import('./ros3d');
    expect(() => new Viewer({ divID: 'missing', width: 640, height: 480, antialias: true })).toThrow(
      'Element with ID missing not found'
    );
    expect(scheduledFrames).toHaveLength(0);
  });

  it('coalesces invalidations and stops after rendering the latest scene state', async () => {
    const { Viewer } = await import('./ros3d');
    const viewer = new Viewer({ divID: 'viewer', width: 640, height: 480, antialias: true });
    const renderer = viewer.renderer as unknown as {
      setSize: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
    };

    expect(scheduledFrames).toHaveLength(1);
    viewer.requestRender();
    expect(scheduledFrames).toHaveLength(1);

    const runNextFrame = () => {
      const nextFrame = scheduledFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
      expect(nextFrame).toBeDefined();
      scheduledFrames.delete(nextFrame![0]);
      nextFrame![1](performance.now());
    };

    runNextFrame();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(scheduledFrames).toHaveLength(0);

    viewer.addObject(new THREE.Object3D());
    expect(scheduledFrames).toHaveLength(1);
    runNextFrame();

    viewer.resize(640, 480);
    expect(scheduledFrames).toHaveLength(0);
    viewer.resize(800, 600);
    expect(renderer.setSize).toHaveBeenLastCalledWith(800, 600);
    expect(scheduledFrames).toHaveLength(1);

    viewer.stop();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(scheduledFrames).toHaveLength(0);
  });

  it('fits calibrated camera projection on resize and resets only the owning camera', async () => {
    const { Viewer, OrbitControls } = await import('./ros3d');
    const viewer = new Viewer({ divID: 'viewer', width: 640, height: 480, antialias: true });
    const normal = viewer.camera.projectionMatrix.clone();
    const calibrated = new THREE.Matrix4().makePerspective(-0.02, 0.01, 0.01, -0.01, 0.01, 100);
    const original = calibrated.clone();
    viewer.setProjection(calibrated, 1.5, 'camera-a');
    const initial = viewer.camera.projectionMatrix.clone();
    expect(initial.equals(normal)).toBe(false);
    expect(calibrated.equals(original)).toBe(true);
    const product = viewer.camera.projectionMatrixInverse.clone().multiply(initial);
    new THREE.Matrix4().elements.forEach((value, index) => expect(product.elements[index]).toBeCloseTo(value));
    viewer.resetProjection('camera-b');
    expect(viewer.camera.projectionMatrix.equals(initial)).toBe(true);
    viewer.resize(1280, 480);
    expect(viewer.camera.projectionMatrix.elements[0]).toBeLessThan(initial.elements[0]);
    viewer.resize(320, 480);
    expect(viewer.camera.projectionMatrix.elements[5]).toBeLessThan(original.elements[5]);
    viewer.resetProjection('camera-a');
    const perspective = new THREE.PerspectiveCamera(
      viewer.camera.fov,
      320 / 480,
      viewer.camera.near,
      viewer.camera.far
    );
    expect(viewer.camera.projectionMatrix.equals(perspective.projectionMatrix)).toBe(true);
    const position = new THREE.Vector3(1, 2, 3),
      target = new THREE.Vector3(1, 2, 4),
      up = new THREE.Vector3(0, -1, 0);
    viewer.controls = new OrbitControls({
      scene: viewer.scene,
      camera: viewer.camera,
      element: viewer.renderer.domElement,
      onChange: viewer.requestRender,
    });
    viewer.controls.setView(position, target, up);
    expect(viewer.camera.position).toEqual(position);
    expect(viewer.camera.up).toEqual(up);
    const direction = viewer.camera.getWorldDirection(new THREE.Vector3());
    expect(direction.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
    viewer.controls.dispose();
    viewer.stop();
  });

  it('renders overlays after the scene, unregisters them, and forbids scheduling from overlay disposal', async () => {
    const { Viewer } = await import('./ros3d');
    const viewer = new Viewer({ divID: 'viewer', width: 640, height: 480, antialias: true });
    const renderer = viewer.renderer as unknown as { render: ReturnType<typeof vi.fn> };
    const overlay = { render: vi.fn(), dispose: vi.fn(() => viewer.requestRender()) };
    const removed = { render: vi.fn(), dispose: vi.fn() };
    viewer.addOverlay(overlay);
    const remove = viewer.addOverlay(removed);
    remove();
    viewer.render();
    expect(overlay.render).toHaveBeenCalledOnce();
    expect(removed.render).not.toHaveBeenCalled();
    expect(renderer.render.mock.invocationCallOrder[0]).toBeLessThan(overlay.render.mock.invocationCallOrder[0]);
    scheduledFrames.clear();
    viewer.stop();
    viewer.requestRender();
    viewer.stop();
    expect(overlay.dispose).toHaveBeenCalledOnce();
    expect(removed.dispose).not.toHaveBeenCalled();
    expect(scheduledFrames).toHaveLength(0);
  });
});
