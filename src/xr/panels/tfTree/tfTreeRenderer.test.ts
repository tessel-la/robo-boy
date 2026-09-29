import * as THREE from 'three';
import { beforeAll, expect, it, vi } from 'vitest';
import { consumeTfMessage, createEmptyTfTreeState } from '../../../features/tfTree/tfTreeModel';
import { registerTfTreePresentation, type TfTreePresentation } from '../../../features/tfTree/presentation';
import { stubCanvasContext } from '../../ui/canvasStub';
import { getSurfaceOf, type SpatialSurface } from '../../ui/SpatialSurface';
import { SurfaceInteraction } from '../../ui/SurfaceInteraction';
import type { XrPanelContext, XrPanelInstance } from '../registry';
import { tfTreePanelRenderer } from './tfTreeRenderer';

beforeAll(stubCanvasContext);
const transform = (parent: string, child: string, x = 1) => ({
  header: { frame_id: parent },
  child_frame_id: child,
  transform: { translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
});
const presentation = (): TfTreePresentation => {
  const p = {
    state: consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('map', 'base')] },
      'dynamic',
      Date.now()
    ),
    settings: { filter: '', showStatic: true, highlightStale: true },
    configure: vi.fn(patch => {
      p.settings = { ...p.settings, ...patch };
    }),
    refresh: vi.fn(),
    setPresented: vi.fn(),
  };
  p.state = consumeTfMessage(p.state, { transforms: [transform('base', 'camera', 2)] }, 'static', Date.now());
  return p;
};
const context = (): XrPanelContext => ({
  panelId: 'tf',
  panelType: 'tfTree',
  title: 'TF tree',
  storageScope: 'robot-a',
  domElement: null,
  ros: null,
  isPassthrough: false,
  meshResourcesBaseUrl: '',
  requestClose: vi.fn(),
  savePlacement: vi.fn(),
  saveView: vi.fn(),
});
const surfaces = (panel: XrPanelInstance) => {
  const list: SpatialSurface[] = [];
  panel.object.traverse(child => {
    const surface = getSurfaceOf(child);
    if (surface) list.push(surface);
  });
  return list;
};
const press = (panel: XrPanelInstance, id: string) => {
  const surface = surfaces(panel).find(surface => surface.getItem(id));
  const item = surface?.getItem(id);
  if (!surface || !item) throw new Error(`Missing ${id}`);
  new SurfaceInteraction().activate({
    object: surface.mesh,
    uv: new THREE.Vector2((item.x + item.w / 2) / surface.pixelWidth, 1 - (item.y + item.h / 2) / surface.pixelHeight),
  } as never);
};
const tick = (panel: XrPanelInstance, time = 1000) => panel.update?.({ time } as never);

it('shares the scoped tree, applies filters, and releases GPU resources without resetting shared TF', () => {
  const p = presentation(),
    other = presentation(),
    ctx = context();
  const unregister = registerTfTreePresentation('tf', p, 'robot-a');
  const unregisterOther = registerTfTreePresentation('tf', other, 'robot-b');
  const panel = tfTreePanelRenderer.create(ctx);
  tick(panel);
  expect(p.setPresented).toHaveBeenCalledWith(true);
  expect(other.setPresented).not.toHaveBeenCalled();
  const graph = surfaces(panel).find(s => s.getItem('graph'))!;
  expect(graph.getItem('frame:camera')).not.toBeNull();
  press(panel, 'settings');
  press(panel, 'row-0');
  expect(p.configure).toHaveBeenCalledWith({ showStatic: false });
  tick(panel, 1200);
  expect(graph.getItem('frame:camera')).toBeNull();
  press(panel, 'frame-larger');
  expect(ctx.savePlacement).toHaveBeenCalledOnce();
  const texture = (graph.mesh.material as THREE.MeshBasicMaterial).map!;
  const dispose = vi.spyOn(texture, 'dispose');
  panel.dispose();
  panel.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  expect(p.setPresented).toHaveBeenLastCalledWith(false);
  expect(p.refresh).not.toHaveBeenCalled();
  unregister();
  unregisterOther();
});

it('does not redraw steady graph geometry for numeric updates, but highlights staleness without messages', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const p = presentation(),
    unregister = registerTfTreePresentation('tf', p, 'robot-a');
  const panel = tfTreePanelRenderer.create(context());
  tick(panel);
  const graph = surfaces(panel).find(s => s.getItem('graph'))!;
  const texture = (graph.mesh.material as THREE.MeshBasicMaterial).map!;
  const version = texture.version;
  tick(panel, 2000);
  expect(texture.version).toBe(version);
  Object.assign(p, {
    state: consumeTfMessage(p.state, { transforms: [transform('map', 'base', 7)] }, 'dynamic', 10000),
  });
  tick(panel, 2200);
  expect(texture.version).toBe(version);
  now.mockReturnValue(16000);
  tick(panel, 3000);
  expect(texture.version).toBeGreaterThan(version);
  const staleVersion = texture.version;
  now.mockReturnValue(17000);
  tick(panel, 4000);
  expect(texture.version).toBe(staleVersion);
  panel.dispose();
  unregister();
  now.mockRestore();
});

it('waits for late mounts and follows replay replacements while preserving the frame', () => {
  const panel = tfTreePanelRenderer.create(context());
  tick(panel);
  const first = presentation(),
    unregisterFirst = registerTfTreePresentation('tf', first, 'robot-a');
  tick(panel, 2000);
  press(panel, 'frame:base');
  const second = presentation();
  const unregisterSecond = registerTfTreePresentation('tf', second, 'robot-a');
  unregisterFirst();
  tick(panel, 3000);
  expect(first.setPresented).toHaveBeenLastCalledWith(false);
  expect(second.setPresented).toHaveBeenLastCalledWith(true);
  panel.setActive?.(false);
  expect(second.setPresented).toHaveBeenLastCalledWith(false);
  panel.setActive?.(true);
  unregisterSecond();
  tick(panel, 4000);
  expect(
    surfaces(panel)
      .find(s => s.getItem('graph'))
      ?.getItem('frame:base')
  ).toBeNull();
  panel.dispose();
});

it('calculates live transforms and reports disconnected paths through the docked menu', () => {
  const p = presentation(),
    unregister = registerTfTreePresentation('tf', p, 'robot-a');
  const panel = tfTreePanelRenderer.create(context());
  tick(panel);
  press(panel, 'settings');
  press(panel, 'row-4'); // calculator
  press(panel, 'row-0');
  press(panel, 'row-2'); // source map (base,camera,map)
  press(panel, 'row-1');
  press(panel, 'row-1'); // target camera
  press(panel, 'row-3'); // transform values
  const menu = surfaces(panel).find(s => s.getItem('row-0'))!;
  const read = (id: string) => {
    const fillText = vi.fn();
    const item = menu.getItem(id)!;
    item.draw({ fillText, measureText: () => ({ width: 0 }) } as unknown as CanvasRenderingContext2D, item, {
      hover: false,
    });
    return fillText.mock.calls.map(call => call[0]);
  };
  expect(read('row-0')).toEqual(['Translation X (m)', '3']);
  Object.assign(p, {
    state: consumeTfMessage(p.state, { transforms: [transform('map', 'base', 4)] }, 'dynamic', Date.now()),
  });
  tick(panel, 2000);
  expect(read('row-0')).toEqual(['Translation X (m)', '6']);
  Object.assign(p, { state: createEmptyTfTreeState() });
  tick(panel, 3000);
  expect(read('row-0')).toEqual(['Status', 'No valid transform path']);
  panel.dispose();
  unregister();
});
