import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPadPresentation, type PadPresentation } from '../../../features/customGamepad/presentation';
import type { CustomGamepadLayout } from '../../../features/customGamepad/types';
import type { PadSpatialControl } from '../../../features/customGamepad/spatialControl';
import { stubCanvasContext } from '../../ui/canvasStub';
import { getSurfaceOf, type SpatialSurface } from '../../ui/SpatialSurface';
import { SurfaceInteraction } from '../../ui/SurfaceInteraction';
import type { XrPanelContext } from '../registry';
import type { XrInputTarget } from '../../XrInputManager';
import { XrGrabController } from '../../grabbable';
import { padPanelRenderer } from './padRenderer';
import { padPoseKey, readPadPoses } from './padSpatialLayout';
import { getGamepadLayout, saveCustomGamepad } from '../../../features/customGamepad/gamepadStorage';

const { handlers, capture } = vi.hoisted(() => ({
  handlers: new WeakMap<HTMLElement, PadSpatialControl>(),
  capture: vi.fn(),
}));
vi.mock('../../../features/customGamepad/spatialControl', () => ({
  getPadSpatialControl: (el: HTMLElement) => handlers.get(el) ?? null,
}));
vi.mock('../../../panels/capturePanelSurface', () => ({ capturePanelSurface: capture }));
beforeAll(stubCanvasContext);
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});
const layout = (): CustomGamepadLayout => ({
  id: 'test-layout',
  name: 'Drive',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [
    {
      id: 'button',
      type: 'button',
      label: 'Hold',
      position: { x: 0, y: 0, width: 1, height: 1 },
      action: { topic: '/hold', messageType: 'std_msgs/Bool' },
    },
    {
      id: 'stick',
      type: 'joystick',
      label: 'Drive',
      position: { x: 1, y: 0, width: 2, height: 2 },
      config: { axes: ['linear.x', 'angular.z'] },
      action: { topic: '/cmd_vel', messageType: 'geometry_msgs/Twist' },
    },
    { id: 'dpad', type: 'dpad', position: { x: 3, y: 0, width: 2, height: 2 } },
  ],
  rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' },
  metadata: { created: '', modified: '', version: '1.0.0' },
});
function setup(isDefault = false) {
  const dom = document.createElement('div');
  dom.innerHTML = `<div class="custom-gamepad-layout"><div data-component-id="button"><button class="button-component">Hold</button></div>
    <div data-component-id="stick"><div class="joystick-component"></div></div>
    <div data-component-id="dpad"><div class="dpad-component"><button>up</button><button>left</button><button>right</button><button>down</button></div></div></div>`;
  document.body.append(dom);
  const button = { start: vi.fn(), end: vi.fn() },
    stick = { start: vi.fn(), move: vi.fn(), end: vi.fn(), drag: true };
  handlers.set(dom.querySelector('.button-component')!, button);
  handlers.set(dom.querySelector('.joystick-component')!, stick);
  const directions = [...dom.querySelectorAll<HTMLElement>('.dpad-component button')].map(el => {
    const control = { start: vi.fn(), end: vi.fn() };
    handlers.set(el, control);
    return control;
  });
  let activeLayout = layout();
  const p: PadPresentation = {
    layoutId: 'test-layout',
    get layout() {
      return activeLayout;
    },
    layouts: [],
    isDefault,
    selectLayout: vi.fn(),
    setEditing: vi.fn(),
    saveLayout: vi.fn(() => true),
  };
  const unregister = registerPadPresentation('pad', p, 'robot');
  const ctx: XrPanelContext = {
    panelId: 'pad',
    panelType: 'pad',
    title: 'Pad',
    domElement: dom,
    ros: null,
    storageScope: 'robot',
    isPassthrough: false,
    meshResourcesBaseUrl: '',
    requestClose: vi.fn(),
    savePlacement: vi.fn(),
    saveView: vi.fn(),
  };
  const panel = padPanelRenderer.create(ctx);
  tick(panel);
  return {
    panel,
    p,
    button,
    stick,
    directions,
    updateLayout: (next: CustomGamepadLayout) => {
      activeLayout = next;
    },
    close: () => {
      panel.dispose();
      unregister();
    },
  };
}
function tick(panel: ReturnType<typeof padPanelRenderer.create>, time = 1000) {
  panel.update?.({ time } as never);
}
function surfaces(object: THREE.Object3D) {
  const result: SpatialSurface[] = [];
  object.traverseVisible(child => {
    const surface = getSurfaceOf(child);
    if (surface) result.push(surface);
  });
  return result;
}
function press(panel: ReturnType<typeof padPanelRenderer.create>, id: string) {
  const surface = surfaces(panel.object).find(s => s.getItem(id));
  const item = surface?.getItem(id);
  if (!surface || !item) throw new Error(`Missing ${id}`);
  new SurfaceInteraction().activate({
    object: surface.mesh,
    point: new THREE.Vector3(),
    distance: 1,
    uv: new THREE.Vector2((item.x + item.w / 2) / surface.pixelWidth, 1 - (item.y + item.h / 2) / surface.pixelHeight),
  });
}
function hit(
  panel: ReturnType<typeof padPanelRenderer.create>,
  id: string,
  x = 0.5,
  y = 0.5,
  part = ''
): XrInputTarget {
  const object = panel.object.getObjectByName(
    `xr-pad-hit:${id}${part ? ':' + part : ''}`
  ) as THREE.Mesh<THREE.PlaneGeometry>;
  const { width, height } = object.geometry.parameters;
  panel.object.updateMatrixWorld(true);
  return {
    object,
    point: object.localToWorld(new THREE.Vector3((x - 0.5) * width, (0.5 - y) * height, 0)),
    uv: new THREE.Vector2(x, 1 - y),
    distance: 1,
  };
}
function write(panel: ReturnType<typeof padPanelRenderer.create>, text: string) {
  press(panel, 'clear');
  for (const char of text) {
    let surface = surfaces(panel.object).find(s => s.mesh.name === 'xr-pad-keyboard')!;
    if (!surface.getItem(`key-${char}`)) {
      press(panel, 'symbols');
      surface = surfaces(panel.object).find(s => s.mesh.name === 'xr-pad-keyboard')!;
    }
    if (!surface.getItem(`key-${char}`)) throw new Error(`Missing key ${char}`);
    press(panel, `key-${char}`);
  }
  press(panel, 'apply-input');
}

describe('spatial Pad and immersive editor', () => {
  it('renders actual volumes and reuses balanced command ownership without capture for native controls', () => {
    const { panel, button, stick, close } = setup();
    const volumes: THREE.Object3D[] = [];
    panel.object.traverse(object => {
      if ((object as THREE.Mesh).geometry?.type === 'ExtrudeGeometry') volumes.push(object);
    });
    expect(volumes.length).toBeGreaterThan(3);
    expect(capture).not.toHaveBeenCalled();
    panel.onPressStart?.('right', hit(panel, 'stick', 0.8, 0.2));
    expect(stick.start).toHaveBeenCalledWith(0.8, expect.closeTo(0.2));
    panel.onPressStart?.('left', hit(panel, 'stick'));
    panel.onPressEnd?.('left', false);
    expect(stick.end).not.toHaveBeenCalled();
    panel.onPressMove?.('right', hit(panel, 'stick', 0.2, 0.5));
    expect(stick.move).toHaveBeenCalledWith(expect.closeTo(0.2), 0.5);
    panel.onPressMove?.('right', hit(panel, 'button'));
    expect(stick.end).toHaveBeenCalledOnce();
    panel.onPressStart?.('right', hit(panel, 'button'));
    panel.setActive?.(false);
    expect(button.end).toHaveBeenCalledOnce();
    close();
    expect(button.end).toHaveBeenCalledOnce();
  });

  it('maps each 3D D-pad direction to the matching mounted handler', () => {
    const { panel, directions, close } = setup();
    for (const [index, direction] of ['up', 'left', 'right', 'down'].entries()) {
      panel.onPressStart?.('right', hit(panel, 'dpad', 0.5, 0.5, direction));
      panel.onPressEnd?.('right', false);
      expect(directions[index].start).toHaveBeenCalledOnce();
      expect(directions[index].end).toHaveBeenCalledOnce();
    }
    close();
  });

  it('releases before editing, disables commands, and cancels draft poses without changing the desktop grid', () => {
    const { panel, p, button, close } = setup();
    const original = JSON.stringify(p.layout);
    panel.onPressStart?.('right', hit(panel, 'button'));
    press(panel, 'pad-editor');
    expect(button.end).toHaveBeenCalledOnce();
    expect(p.setEditing).toHaveBeenLastCalledWith(true);
    panel.onPressStart?.('right', hit(panel, 'button'));
    expect(button.start).toHaveBeenCalledOnce();
    const object = panel.object.getObjectByName('xr-pad-control:button')!;
    expect(object.userData.xrGrabbable).toBe(true);
    object.position.z += 0.2;
    object.userData.onGrabEnd(object);
    expect(localStorage.getItem(padPoseKey('test-layout', 'robot'))).toBeNull();
    press(panel, 'pad-cancel');
    expect(p.setEditing).toHaveBeenLastCalledWith(false);
    expect(JSON.stringify(p.layout)).toBe(original);
    expect(p.saveLayout).not.toHaveBeenCalled();
    expect(panel.object.getObjectByName('xr-pad-control:button')!.position.z).toBe(0.025);
    close();
  });

  it('uses the existing grab controller to carry objects and persists only XR poses on Save', () => {
    const { panel, p, close } = setup();
    const grid = JSON.stringify(p.layout!.components.map(c => c.position));
    press(panel, 'pad-editor');
    const object = panel.object.getObjectByName('xr-pad-control:button')!;
    const grabs = new XrGrabController();
    const start = { id: 'right', matrixWorld: new THREE.Matrix4(), origin: new THREE.Vector3() };
    grabs.begin(object, start, true);
    const matrixWorld = new THREE.Matrix4().makeRotationY(0.3);
    matrixWorld.setPosition(0.1, 0, 0.2);
    grabs.update(new Map([['right', { ...start, matrixWorld }]]));
    object.scale.setScalar(1.3);
    object.userData.onGrabEnd(object);
    const pose = {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.x,
    };
    press(panel, 'pad-save');
    expect(readPadPoses('test-layout', 'robot').button).toEqual(pose);
    const saved = vi.mocked(p.saveLayout!).mock.calls[0][0];
    expect(JSON.stringify(saved.components.map(c => c.position))).toBe(grid);
    expect(saved.components[1].config?.axes).toEqual(['linear.x', 'angular.z']);
    expect(p.setEditing).toHaveBeenLastCalledWith(false);
    close();
    const reopened = setup();
    expect(reopened.panel.object.getObjectByName('xr-pad-control:button')!.position.toArray()).toEqual(pose.position);
    reopened.close();
  });

  it('edits labels with the immersive keyboard and clones templates on save', () => {
    const { panel, p, close } = setup(true);
    const original = JSON.stringify(p.layout);
    press(panel, 'pad-editor');
    panel.onActivate?.(hit(panel, 'button'));
    press(panel, 'row-0');
    write(panel, 'start');
    press(panel, 'pad-save');
    const saved = vi.mocked(p.saveLayout!).mock.calls[0][0];
    expect(saved.id).not.toBe('test-layout');
    expect(saved.components[0].label).toBe('start');
    expect(JSON.stringify(p.layout)).toBe(original);
    expect(readPadPoses('test-layout', 'robot')).toEqual({});
    expect(Object.keys(readPadPoses(saved.id, 'robot'))).toHaveLength(3);
    close();
  });

  it('does not overwrite a new layout saved by another designer while a template draft is open', () => {
    const { panel, p, close } = setup(true);
    press(panel, 'pad-editor');
    const other = { ...layout(), id: 'custom-drive-copy', name: 'Another copy' };
    expect(saveCustomGamepad(other)).toBe(true);
    press(panel, 'pad-save');
    const saved = vi.mocked(p.saveLayout!).mock.calls[0][0];
    expect(saved.id).toBe('custom-drive-copy-1');
    expect(getGamepadLayout(other.id)?.name).toBe('Another copy');
    close();
  });

  it('adds from the existing palette, and preserves a draft and previous poses when save fails', () => {
    const { panel, p, close } = setup();
    const previous = { button: { position: [0.1, 0.2, 0.3], quaternion: [0, 0, 0, 1], scale: 1 } };
    localStorage.setItem(padPoseKey('test-layout', 'robot'), JSON.stringify(previous));
    press(panel, 'pad-editor');
    press(panel, 'row-2');
    press(panel, 'row-1'); // Add physical gamepad, using fitted free grid cells.
    const objects: string[] = [];
    panel.object.traverse(object => {
      if (object.userData.componentId) objects.push(object.userData.componentId);
    });
    expect(objects.some(id => id.startsWith('physical-gamepad-'))).toBe(true);
    vi.mocked(p.saveLayout!).mockReturnValue(false);
    press(panel, 'pad-save');
    expect(p.setEditing).toHaveBeenLastCalledWith(true);
    expect(readPadPoses('test-layout', 'robot')).toEqual(previous);
    press(panel, 'pad-cancel');
    expect(p.setEditing).toHaveBeenLastCalledWith(false);
    close();
  });

  it('configures physical-gamepad press bindings inside XR without executing an operation', () => {
    const { panel, p, close } = setup();
    press(panel, 'pad-editor');
    press(panel, 'row-2');
    press(panel, 'row-1'); // Palette: physical gamepad.
    press(panel, 'row-3');
    press(panel, 'row-0');
    press(panel, 'row-0'); // Bindings: A, press.
    press(panel, 'row-0');
    press(panel, 'row-1'); // Kind: service.
    press(panel, 'row-1');
    write(panel, '/start');
    press(panel, 'row-2');
    write(panel, 'example/srv/trigger');
    press(panel, 'pad-save');
    const saved = vi.mocked(p.saveLayout!).mock.calls[0][0];
    expect(
      saved.components.find(c => c.type === 'physical-gamepad')?.config?.physicalGamepadBindings?.['face-bottom']?.press
    ).toEqual({ kind: 'service', name: '/start', messageType: 'example/srv/trigger', payload: {} });
    expect(p.setEditing).toHaveBeenLastCalledWith(false);
    close();
  });

  it('keeps poses scoped and rejects invalid storage without crashing on imported ids', () => {
    const pose = { position: [0, 0.3, 0], quaternion: [0, 0, 0, 1], scale: 1 };
    localStorage.setItem(
      padPoseKey('layout', 'a'),
      JSON.stringify({
        valid: pose,
        bad: { ...pose, scale: 100 },
        far: { ...pose, position: [100, 0, 0] },
        rotation: { ...pose, quaternion: [0, 0, 0, 0] },
        constructor: pose,
      })
    );
    expect(readPadPoses('layout', 'a')).toEqual({ valid: pose, constructor: pose });
    expect(readPadPoses('layout', 'b')).toEqual({});
    localStorage.setItem(padPoseKey('layout', 'a'), 'oops');
    expect(readPadPoses('layout', 'a')).toEqual({});
  });

  it('keeps an unsaved draft open when the source changes and refuses to overwrite it', () => {
    const { panel, p, close, updateLayout } = setup();
    press(panel, 'pad-editor');
    updateLayout({ ...p.layout!, name: 'Changed elsewhere' });
    tick(panel, 1100);
    expect(panel.object.getObjectByName('xr-pad-control:button')!.userData.xrGrabbable).toBe(true);
    press(panel, 'pad-save');
    expect(p.saveLayout).not.toHaveBeenCalled();
    expect(p.setEditing).toHaveBeenLastCalledWith(true);
    press(panel, 'pad-cancel');
    expect(p.layout?.name).toBe('Changed elsewhere');
    close();
  });

  it('restores play mode and disposes resources once if XR closes while editing', () => {
    const { panel, p, close } = setup();
    press(panel, 'pad-editor');
    const mesh = panel.object.getObjectByName('xr-pad-hit:button') as THREE.Mesh;
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    close();
    panel.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(p.setEditing).toHaveBeenLastCalledWith(false);
    expect(p.saveLayout).not.toHaveBeenCalled();
  });
});
