import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubCanvasContext } from '../ui/canvasStub';
import { dataExplorerPanelRenderer } from './dataExplorerRenderer';
import type { XrInputTarget } from '../XrInputManager';

const fake = vi.hoisted(() => ({ capture: vi.fn(), presented: vi.fn() }));
vi.mock('../../panels/capturePanelSurface', () => ({ capturePanelSurface: fake.capture }));
vi.mock('../../features/dataExplorer/presentation', () => ({ getDataExplorerPresentation: () => fake.presented }));
const rect = (x: number, y: number, width: number, height: number) => new DOMRect(x, y, width, height);
let host: HTMLElement;
beforeEach(() => {
  stubCanvasContext();
  host = document.createElement('div');
  host.innerHTML = '<section class="data-explorer-panel" data-xr-presented="true"><button>Health</button></section>';
  document.body.appendChild(host);
  const root = host.firstElementChild as HTMLElement;
  root.getBoundingClientRect = () => rect(20, 50, 900, 650);
  host.querySelector('button')!.getBoundingClientRect = () => rect(120, 150, 200, 50);
  const image = document.createElement('canvas');
  image.width = 900;
  image.height = 650;
  fake.capture.mockReset();
  fake.capture.mockResolvedValue(image);
  fake.presented.mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
function setup() {
  const panel = dataExplorerPanelRenderer.create({
    panelId: 'one',
    panelType: 'dataExplorer',
    title: 'Data Explorer',
    domElement: host,
    ros: null,
    isPassthrough: false,
    storageScope: 'cell',
    meshResourcesBaseUrl: '',
    requestClose() {},
    savePlacement() {},
    saveView() {},
  });
  const screen = panel.object.getObjectByName('xr-data-explorer-surface') as THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >;
  const hit: XrInputTarget = {
    object: screen,
    uv: new THREE.Vector2(200 / 900, 1 - 125 / 650),
    point: new THREE.Vector3(),
    distance: 0.5,
  };
  const tick = (time: number) => panel.update!({ time } as never);
  return { panel, screen, hit, tick };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
describe('immersive Explorer surface', () => {
  it('routes a painted control to its mounted owner and rejects disabled or removed controls', async () => {
    const t = setup(),
      button = host.querySelector('button')!;
    const click = vi.fn();
    button.addEventListener('click', click);
    t.tick(0);
    await flush();
    expect(fake.presented).toHaveBeenCalledWith(true);
    expect(t.panel.getActivationTarget!(t.hit)).toBe(button);
    t.panel.onActivate!(t.hit);
    expect(click).toHaveBeenCalledTimes(1);
    t.tick(100);
    await flush();
    button.disabled = true;
    t.panel.onActivate!(t.hit);
    expect(click).toHaveBeenCalledTimes(1);
    button.disabled = false;
    button.getBoundingClientRect = () => rect(600, 150, 200, 50);
    expect(t.panel.getActivationTarget!(t.hit)).toBeNull();
    button.remove();
    expect(t.panel.getActivationTarget!(t.hit)).toBeNull();
    t.panel.dispose();
    expect(fake.presented).toHaveBeenLastCalledWith(false);
  });
  it('clips targets hidden behind a scrolling viewport', async () => {
    const t = setup(),
      root = host.firstElementChild!,
      button = host.querySelector('button')!;
    const pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    pane.getBoundingClientRect = () => rect(20, 50, 900, 80);
    root.appendChild(pane);
    pane.appendChild(button);
    t.tick(0);
    await flush();
    expect(t.panel.getActivationTarget!(t.hit)).toBeNull();
    t.panel.dispose();
  });
  it('caps captures and ignores a late image after attention loss or disposal', async () => {
    const t = setup();
    let resolve!: (canvas: HTMLCanvasElement) => void;
    fake.capture.mockImplementationOnce(
      () =>
        new Promise<HTMLCanvasElement>(done => {
          resolve = done;
        })
    );
    t.tick(0);
    t.tick(100);
    expect(fake.capture).toHaveBeenCalledTimes(1);
    const version = t.screen.material.map!.version;
    t.panel.setActive!(false);
    resolve(document.createElement('canvas'));
    await flush();
    expect(t.screen.material.map!.version).toBe(version);
    t.panel.dispose();
    t.panel.dispose();
  });
});
