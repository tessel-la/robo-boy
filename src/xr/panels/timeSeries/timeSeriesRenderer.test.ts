import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDesiredSources, sanitizeConfig } from '../../../features/timeSeries/config';
import { TimeSeriesEngine } from '../../../features/timeSeries/engine';
import { registerTimeSeriesPresentation, type TimeSeriesPresentation } from '../../../features/timeSeries/presentation';
import { stubCanvasContext } from '../../ui/canvasStub';
import { getSurfaceOf, type SpatialSurface } from '../../ui/SpatialSurface';
import { SurfaceInteraction } from '../../ui/SurfaceInteraction';
import type { XrPanelContext } from '../registry';
import { timeSeriesPanelRenderer } from './timeSeriesRenderer';

beforeAll(stubCanvasContext);

const context = (): XrPanelContext => ({
  panelId: 'series',
  panelType: 'timeSeries',
  title: 'Time Series',
  domElement: null,
  ros: null,
  isPassthrough: false,
  meshResourcesBaseUrl: '',
  requestClose: vi.fn(),
  savePlacement: vi.fn(),
  saveView: vi.fn(),
});
const presentation = (): TimeSeriesPresentation => {
  const engine = new TimeSeriesEngine(
    sanitizeConfig({
      schemaVersion: 4,
      series: [{ id: 'a', topic: '/a', messageType: 'T', fieldPath: 'x', math: { expression: 'x * 2' } }],
    })
  );
  return {
    engine,
    ros: null,
    connected: true,
    error: '',
    configure: vi.fn(config => engine.configure(config)),
    setPresented: vi.fn(),
  };
};
const surfaces = (object: THREE.Object3D): SpatialSurface[] => {
  const list: SpatialSurface[] = [];
  object.traverse(child => {
    const s = getSurfaceOf(child);
    if (s) list.push(s);
  });
  return list;
};
const press = (object: THREE.Object3D, id: string) => {
  const surface = surfaces(object).find(s => s.getItem(id));
  const item = surface?.getItem(id);
  if (!surface || !item) throw new Error(`Missing ${id}`);
  new SurfaceInteraction().activate({
    object: surface.mesh,
    uv: new THREE.Vector2((item.x + item.w / 2) / surface.pixelWidth, 1 - (item.y + item.h / 2) / surface.pixelHeight),
  } as never);
};
const tick = (panel: ReturnType<typeof timeSeriesPanelRenderer.create>, time = 1000) =>
  panel.update?.({ time } as never);

describe('native Time Series', () => {
  it('isolates identical panel ids in separate robot connections', () => {
    const first = presentation(),
      second = presentation();
    const removeFirst = registerTimeSeriesPresentation('series', first, 'robot-a');
    const removeSecond = registerTimeSeriesPresentation('series', second, 'robot-b');
    const panel = timeSeriesPanelRenderer.create({ ...context(), storageScope: 'robot-a' });
    tick(panel);
    press(panel.object, 'pause');
    expect(first.engine.paused).toBe(true);
    expect(second.engine.paused).toBe(false);
    expect(second.setPresented).not.toHaveBeenCalled();
    panel.dispose();
    removeFirst();
    removeSecond();
  });
  it('uses the mounted engine, draws only changed data at the configured rate, and preserves history on teardown', () => {
    const p = presentation();
    const unregister = registerTimeSeriesPresentation('series', p);
    const ctx = context();
    const panel = timeSeriesPanelRenderer.create(ctx);
    tick(panel);
    expect(p.setPresented).toHaveBeenCalledWith(true);
    const surface = surfaces(panel.object).find(s => s.getItem('plot'))!;
    const texture = (surface.mesh.material as THREE.MeshBasicMaterial).map!;
    const version = texture.version;
    tick(panel, 2000);
    expect(texture.version).toBe(version);
    p.engine.receive(getDesiredSources(p.engine.config)[0], { x: 3 }, 5000);
    tick(panel, 2020);
    expect(texture.version).toBeGreaterThan(version);
    const nextVersion = texture.version;
    p.engine.receive(getDesiredSources(p.engine.config)[0], { x: 4 }, 5010);
    tick(panel, 2030);
    expect(texture.version).toBe(nextVersion);
    tick(panel, 2080);
    expect(texture.version).toBeGreaterThan(nextVersion);
    press(panel.object, 'frame-larger');
    expect(ctx.savePlacement).toHaveBeenCalledOnce();
    press(panel.object, 'close');
    expect(ctx.requestClose).toHaveBeenCalledOnce();
    const disposeTexture = vi.spyOn(texture, 'dispose');
    panel.dispose();
    panel.dispose();
    expect(disposeTexture).toHaveBeenCalledOnce();
    expect(p.setPresented).toHaveBeenLastCalledWith(false);
    expect(p.engine.snapshot().get('a')).toHaveLength(2);
    unregister();
  });

  it('shares pause and legend edits and follows late mounts and replay remounts', () => {
    const panel = timeSeriesPanelRenderer.create(context());
    tick(panel);
    expect(
      surfaces(panel.object)
        .find(s => s.getItem('pause'))
        ?.getItem('pause')?.disabled
    ).toBe(true);
    const first = presentation();
    const unregisterFirst = registerTimeSeriesPresentation('series', first);
    tick(panel, 2000);
    press(panel.object, 'pause');
    expect(first.engine.paused).toBe(true);
    press(panel.object, 'signal-a');
    expect(first.engine.config.series[0]).toMatchObject({ enabled: false, math: { expression: 'x * 2' } });
    const second = presentation();
    const unregisterSecond = registerTimeSeriesPresentation('series', second);
    unregisterFirst(); // old React effect must not remove the replacement
    tick(panel, 3000);
    expect(first.setPresented).toHaveBeenLastCalledWith(false);
    expect(second.setPresented).toHaveBeenLastCalledWith(true);
    press(panel.object, 'pause');
    expect(second.engine.paused).toBe(true);
    panel.setActive?.(false);
    expect(second.setPresented).toHaveBeenLastCalledWith(false);
    unregisterSecond();
    panel.setActive?.(true);
    tick(panel, 4000);
    expect(
      surfaces(panel.object)
        .find(s => s.getItem('pause'))
        ?.getItem('pause')?.disabled
    ).toBe(true);
    panel.dispose();
  });

  it('applies settings through the desktop callback and clears history', () => {
    const p = presentation();
    const unregister = registerTimeSeriesPresentation('series', p);
    const panel = timeSeriesPanelRenderer.create(context());
    tick(panel);
    press(panel.object, 'settings');
    press(panel.object, 'row-2'); // plot settings
    press(panel.object, 'row-0:inc');
    expect(p.configure).toHaveBeenCalled();
    expect(p.engine.config.timeWindowSec).toBe(20);
    press(panel.object, 'back');
    p.engine.receive(getDesiredSources(p.engine.config)[0], { x: 4 }, 5000);
    press(panel.object, 'zoom-in');
    press(panel.object, 'row-3'); // clear
    expect(p.engine.snapshot().get('a')).toHaveLength(0);
    press(panel.object, 'row-0'); // disconnected topic picker tolerates no ROS
    panel.dispose();
    unregister();
  });

  it('refreshes an open field picker when the first message discovers fields', () => {
    const p = presentation();
    const unregister = registerTimeSeriesPresentation('series', p);
    const panel = timeSeriesPanelRenderer.create(context());
    tick(panel);
    press(panel.object, 'settings');
    press(panel.object, 'row-1'); // signals
    press(panel.object, 'row-0'); // signal
    press(panel.object, 'row-1'); // fields, before any message
    const menu = surfaces(panel.object).find(s => s.getItem('empty'))!;
    expect(menu.getItem('row-0')).toBeNull();
    p.engine.receive(getDesiredSources(p.engine.config)[0], { x: 1, y: 2 }, 5000);
    tick(panel, 2000);
    expect(menu.getItem('row-1')).not.toBeNull();
    press(panel.object, 'row-1');
    expect(p.engine.config.series[0].fieldPath).toBe('y');
    panel.dispose();
    unregister();
  });
});
