import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { XrInputTarget } from '../XrInputManager';
import { stubCanvasContext } from './canvasStub';
import { HintBoard } from './HintBoard';
import { FRAME_SCALE_LIMITS, PanelFrame } from './PanelFrame';
import { SpatialMenu } from './SpatialMenu';
import { getSurfaceOf, type SpatialSurface } from './SpatialSurface';
import { SurfaceInteraction } from './SurfaceInteraction';
import { WristMenu, shouldShowWristMenu } from './WristMenu';

beforeAll(stubCanvasContext);

const hit = (surface: SpatialSurface, id: string): XrInputTarget => {
  const item = surface.getItem(id);
  if (!item) throw new Error(`no item ${id}`);
  return {
    object: surface.mesh,
    uv: new THREE.Vector2(
      (item.x + item.w / 2) / surface.pixelWidth,
      1 - (item.y + item.h / 2) / surface.pixelHeight
    ),
  } as unknown as XrInputTarget;
};

const surfaces = (root: THREE.Object3D): SpatialSurface[] => {
  const found: SpatialSurface[] = [];
  root.traverse(child => {
    const surface = getSurfaceOf(child);
    if (surface) found.push(surface);
  });
  return found;
};

const press = (surface: SpatialSurface, id: string) => new SurfaceInteraction().activate(hit(surface, id));

describe('shouldShowWristMenu', () => {
  const head = new THREE.Vector3(0, 1.6, 0);
  const forward = new THREE.Vector3(0, 0, -1);

  it('shows when the wrist is raised into view at arm reach', () => {
    expect(shouldShowWristMenu(head, forward, new THREE.Vector3(0, 1.5, -0.4), false)).toBe(true);
  });

  it('stays hidden with the arm down, behind, too close or too far', () => {
    expect(shouldShowWristMenu(head, forward, new THREE.Vector3(0, 0.9, -0.1), false)).toBe(false);
    expect(shouldShowWristMenu(head, forward, new THREE.Vector3(0, 1.6, 0.4), false)).toBe(false);
    expect(shouldShowWristMenu(head, forward, new THREE.Vector3(0, 1.6, -0.05), false)).toBe(false);
    expect(shouldShowWristMenu(head, forward, new THREE.Vector3(0, 1.6, -1.2), false)).toBe(false);
  });

  it('keeps showing a little past the angle that would show it', () => {
    const wrist = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(52)) * 0.4, 1.6, -Math.cos(THREE.MathUtils.degToRad(52)) * 0.4);
    expect(shouldShowWristMenu(head, forward, wrist, false)).toBe(false);
    expect(shouldShowWristMenu(head, forward, wrist, true)).toBe(true);
  });
});

describe('WristMenu', () => {
  const build = (wrist: THREE.Matrix4 | null = new THREE.Matrix4().makeTranslation(0.1, 1.4, -0.4)) => {
    const parent = new THREE.Group();
    const options = {
      input: { getWristPose: vi.fn(() => (wrist ? { matrix: wrist, tracked: true } : null)) },
      parent,
      getCatalog: () => [
        { id: '3d', name: '3D', description: 'Scene' },
        { id: 'log', name: 'Log' },
      ],
      getPanels: () => [{ id: 'p1', title: 'Robot view' }],
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      onSummon: vi.fn(),
    };
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    return { menu: new WristMenu(options), options, camera, parent };
  };

  it('starts hidden and excludes the wrist hand from pointing at it', () => {
    const { menu } = build();
    expect(menu.isVisible).toBe(false);
    expect(menu.object.visible).toBe(false);
    expect(menu.object.userData.xrExcludeHandedness).toBe('left');
  });

  it('appears above the raised wrist, and hides again when the hand drops', () => {
    const { menu, options, camera } = build();
    menu.update(camera, 0.016);
    expect(menu.isVisible).toBe(true);
    expect(menu.object.position.y).toBeCloseTo(1.4 + 0.17);
    options.input.getWristPose.mockReturnValue({ matrix: new THREE.Matrix4().makeTranslation(0, 0.5, 0), tracked: true });
    menu.update(camera, 0.016);
    expect(menu.isVisible).toBe(false);
  });

  it('stays hidden when the hand is not tracked', () => {
    const { menu, camera } = build(null);
    menu.update(camera, 0.016);
    expect(menu.isVisible).toBe(false);
  });

  it('adds catalogue panels, and switches to open panels to summon or remove them', () => {
    const { menu, options } = build();
    const surface = surfaces(menu.object)[0];
    press(surface, 'row-1');
    expect(options.onAdd).toHaveBeenCalledWith('log');
    press(surface, 'tab-open');
    press(surface, 'row-0');
    expect(options.onSummon).toHaveBeenCalledWith('p1');
    press(surface, 'row-0:secondary');
    expect(options.onRemove).toHaveBeenCalledWith('p1');
  });

  it('removes itself from its parent on dispose', () => {
    const { menu, parent } = build();
    menu.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe('HintBoard', () => {
  it('is visible-toggleable and lets rays pass through', () => {
    const board = new HintBoard('Title', 'Body');
    expect(board.object.userData.xrPickable).toBe(false);
    board.setVisible(false);
    expect(board.object.visible).toBe(false);
    const parent = new THREE.Group();
    parent.add(board.object);
    board.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe('PanelFrame', () => {
  const build = () => {
    const onClose = vi.fn();
    const onPlacementChange = vi.fn();
    const frame = new PanelFrame({ panelId: 'p1', title: 'Scene', isPassthrough: false, onClose, onPlacementChange });
    frame.setToolbar([{ id: 'custom', icon: 'fit', label: 'Fit', onPress: vi.fn() }]);
    return { frame, onClose, onPlacementChange };
  };
  const toolbarSurface = (frame: PanelFrame) => surfaces(frame.object).find(surface => surface.getItem('frame-larger'))!;
  const titleSurface = (frame: PanelFrame) => surfaces(frame.object).find(surface => surface.getItem('close'))!;

  it('is a grabbable, scalable panel keyed by its id', () => {
    const { frame } = build();
    expect(frame.object.userData).toMatchObject({ xrGrabbable: true, placementId: 'p1', allowScale: true });
  });

  it('closes from the title bar', () => {
    const { frame, onClose } = build();
    press(titleSurface(frame), 'close');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('steps its size within limits and persists each change', () => {
    const { frame, onPlacementChange } = build();
    press(toolbarSurface(frame), 'frame-larger');
    expect(frame.object.scale.x).toBeGreaterThan(1);
    expect(onPlacementChange).toHaveBeenCalledOnce();
    for (let index = 0; index < 20; index += 1) frame.stepSize(1.5);
    expect(frame.object.scale.x).toBe(FRAME_SCALE_LIMITS.max);
    for (let index = 0; index < 40; index += 1) frame.stepSize(0.5);
    expect(frame.object.scale.x).toBe(FRAME_SCALE_LIMITS.min);
  });

  it('clamps scale when grabbed and follows the limit in the size buttons', () => {
    const { frame } = build();
    const constrain = (frame.object.userData as { constrain: (object: THREE.Object3D) => void }).constrain;
    frame.object.scale.setScalar(50);
    constrain(frame.object);
    expect(frame.object.scale.x).toBe(FRAME_SCALE_LIMITS.max);
    expect(toolbarSurface(frame).getItem('frame-larger')?.disabled).toBe(true);
    expect(toolbarSurface(frame).getItem('frame-smaller')?.disabled).toBe(false);
    frame.object.scale.setScalar(1);
    constrain(frame.object);
    expect(toolbarSurface(frame).getItem('frame-larger')?.disabled).toBe(false);
  });

  it('docks an attached menu and disposes with it', () => {
    const { frame } = build();
    const menu = new SpatialMenu({ width: 0.5 });
    frame.attachMenu(menu);
    expect(menu.object.parent).not.toBeNull();
    const parent = new THREE.Group();
    parent.add(frame.object);
    frame.setTitle('Scene', 'Fixed frame · map');
    frame.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
