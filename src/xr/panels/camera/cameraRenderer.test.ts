import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { registerCameraPresentation, type CameraSnapshot } from '../../../features/camera/presentation';
import { stubCanvasContext } from '../../ui/canvasStub';
import { getSurfaceOf } from '../../ui/SpatialSurface';
import { SurfaceInteraction } from '../../ui/SurfaceInteraction';
import { cameraPanelRenderer } from './cameraRenderer';

beforeAll(stubCanvasContext);
function setup() {
  const snapshot: CameraSnapshot = {
    topic: '/a',
    topics: ['/a', '/b'],
    source: document.createElement('canvas'),
    revision: 1,
    recorded: true,
    message: '',
  };
  const presentation = { snapshot: () => snapshot, setPresented: vi.fn(), selectTopic: vi.fn(), retry: vi.fn() };
  const remove = registerCameraPresentation('cam', presentation, 'one');
  const other = { ...presentation, setPresented: vi.fn(), selectTopic: vi.fn() };
  const removeOther = registerCameraPresentation('cam', other, 'two');
  const panel = cameraPanelRenderer.create({
    panelId: 'cam',
    panelType: 'camera',
    title: 'Camera',
    storageScope: 'one',
    domElement: null,
    ros: null,
    isPassthrough: false,
    meshResourcesBaseUrl: '',
    requestClose: vi.fn(),
    savePlacement: vi.fn(),
    saveView: vi.fn(),
  });
  const texture = (
    panel.object.getObjectByName('xr-camera-image') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  ).material.map!;
  const tick = (time: number) => panel.update?.({ time } as never);
  const press = (id: string) => {
    let found = false;
    panel.object.traverse(object => {
      const surface = getSurfaceOf(object),
        item = surface?.getItem(id);
      if (!surface || !item || found) return;
      found = true;
      new SurfaceInteraction().activate({
        object,
        uv: new THREE.Vector2(
          (item.x + item.w / 2) / surface.pixelWidth,
          1 - (item.y + item.h / 2) / surface.pixelHeight
        ),
      } as never);
    });
    expect(found).toBe(true);
  };
  return {
    snapshot,
    presentation,
    other,
    panel,
    texture,
    tick,
    press,
    cleanup: () => {
      panel.dispose();
      remove();
      removeOther();
    },
  };
}
describe('native camera', () => {
  it('shares decoded frames and caps uploads without repainting paused replay', () => {
    const t = setup();
    t.tick(0);
    expect(t.presentation.setPresented).toHaveBeenCalledWith(true);
    const version = t.texture.version;
    t.tick(1000);
    expect(t.texture.version).toBe(version);
    t.snapshot.revision = 2;
    t.tick(1010);
    expect(t.texture.version).toBe(version);
    t.tick(1040);
    expect(t.texture.version).toBeGreaterThan(version);
    const latest = t.texture.version;
    t.panel.setActive?.(false);
    t.snapshot.revision = 3;
    t.tick(2000);
    expect(t.texture.version).toBe(latest);
    t.cleanup();
    t.panel.dispose();
    expect(t.other.setPresented).not.toHaveBeenCalled();
  });
  it('selects existing topics through the owning tile and releases presentation on disposal', () => {
    const t = setup();
    t.tick(0);
    t.press('topics');
    t.press('row-1');
    expect(t.presentation.selectTopic).toHaveBeenCalledWith('/b');
    expect(t.other.selectTopic).not.toHaveBeenCalled();
    t.press('retry');
    expect(t.presentation.retry).toHaveBeenCalledOnce();
    t.cleanup();
    expect(t.presentation.setPresented).toHaveBeenLastCalledWith(false);
  });
  it('shows source errors without repeated uploads and resumes on the next good frame', () => {
    const t = setup();
    t.tick(0);
    t.snapshot.message = 'Stream disconnected';
    t.tick(100);
    const version = t.texture.version;
    t.tick(200);
    expect(t.texture.version).toBe(version);
    t.snapshot.message = '';
    t.tick(300);
    expect(t.texture.version).toBeGreaterThan(version);
    t.cleanup();
  });
  it('repaints live MJPEG even though its DOM and source identity do not change', () => {
    const t = setup();
    t.snapshot.revision = null;
    t.snapshot.recorded = false;
    t.tick(0);
    const version = t.texture.version;
    t.tick(50);
    expect(t.texture.version).toBeGreaterThan(version);
    t.cleanup();
  });
  it('contains the frame without stretching and rejects tainted sources until they are replaced', () => {
    const t = setup();
    const context = document.createElement('canvas').getContext('2d')!;
    const previousDraw = context.drawImage,
      previousRead = context.getImageData;
    const draw = vi.fn();
    context.drawImage = draw;
    context.getImageData = vi.fn(() => {
      throw new DOMException('Tainted', 'SecurityError');
    });
    try {
      t.tick(0);
      expect(draw).toHaveBeenCalledWith(t.snapshot.source, 0, 120, 1200, 600);
      const version = t.texture.version;
      t.snapshot.revision = 2;
      t.tick(100);
      expect(draw).toHaveBeenCalledOnce();
      expect(t.texture.version).toBe(version);
      context.getImageData = previousRead;
      t.snapshot.source = document.createElement('canvas');
      t.tick(200);
      expect(t.texture.version).toBeGreaterThan(version);
    } finally {
      context.drawImage = previousDraw;
      context.getImageData = previousRead;
      t.cleanup();
    }
  });
});
