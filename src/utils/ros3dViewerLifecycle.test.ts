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
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      scheduledFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => {
      scheduledFrames.delete(frameId);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('suppresses repeated invalidations while suspended and resumes with one frame', async () => {
    const { Viewer } = await import('./ros3d');
    const viewer = new Viewer({ divID: 'viewer', width: 640, height: 480, antialias: true });
    viewer.setRenderSuspended(true);
    viewer.requestRender();
    viewer.requestRender();
    expect(scheduledFrames).toHaveLength(0);
    viewer.setRenderSuspended(false);
    expect(scheduledFrames).toHaveLength(1);
    viewer.stop();
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
});
