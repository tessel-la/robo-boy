import type { Ros } from 'roslib';
import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnectionStorageKey } from '../../../runtime/connectionStorage';
import { getVisualizationStateForKey } from '../../../utils/visualizationState';
import { stubCanvasContext } from '../../ui/canvasStub';
import { getSurfaceOf, type SpatialSurface } from '../../ui/SpatialSurface';
import { SurfaceInteraction } from '../../ui/SurfaceInteraction';
import type { XrInputTarget } from '../../XrInputManager';
import type { XrPanelContext, XrPanelInstance } from '../registry';

const host = vi.hoisted(() => ({
  instances: [] as Array<{
    setState: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    fixedFrame: string;
    frameNames: string[];
    onTfChanged?: () => void;
  }>,
}));

vi.mock('../../world/displays/DisplayHost', () => ({
  DisplayHost: vi.fn(function (this: unknown, options: { onTfChanged?: () => void }) {
    const instance = {
      setState: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
      fixedFrame: '',
      frameNames: [] as string[],
      onTfChanged: options.onTfChanged,
    };
    host.instances.push(instance);
    return instance;
  }),
}));

import { threeDPanelRenderer } from './threeDRenderer';

beforeAll(stubCanvasContext);

const TOPICS = { topics: ['/robot_description', '/scan'], types: ['std_msgs/msg/String', 'sensor_msgs/msg/LaserScan'] };

const makeRos = (result = TOPICS) =>
  ({ getTopics: vi.fn((ok: (value: typeof TOPICS) => void) => ok(result)) }) as unknown as Ros;

const makeContext = (overrides: Partial<XrPanelContext> = {}): XrPanelContext => ({
  panelId: 'panel-1',
  title: 'Robot view',
  ros: makeRos(),
  isPassthrough: false,
  storageScope: 'robot-a',
  meshResourcesBaseUrl: 'http://robot/meshes',
  requestClose: vi.fn(),
  savePlacement: vi.fn(),
  saveView: vi.fn(),
  ...overrides,
} as unknown as XrPanelContext);

const storageKey = (scope = 'robot-a') => getConnectionStorageKey('roboboy_3d_visualization_state_panel-1', scope);

const pressToolbar = (panel: XrPanelInstance, id: string) => {
  let surface: SpatialSurface | null = null;
  panel.object.traverse(child => {
    const candidate = getSurfaceOf(child);
    if (candidate?.getItem(id)) surface = candidate;
  });
  const found = surface as SpatialSurface | null;
  const item = found?.getItem(id);
  if (!found || !item) throw new Error(`no control ${id}`);
  new SurfaceInteraction().activate({
    object: found.mesh,
    uv: new THREE.Vector2((item.x + item.w / 2) / found.pixelWidth, 1 - (item.y + item.h / 2) / found.pixelHeight),
  } as unknown as XrInputTarget);
};

const findView = (panel: XrPanelInstance): THREE.Object3D => {
  let view: THREE.Object3D | null = null;
  panel.object.traverse(child => {
    if (child.userData.placementId === 'panel-1:view') view = child;
  });
  if (!view) throw new Error('no view');
  return view;
};

beforeEach(() => {
  localStorage.clear();
  host.instances.length = 0;
});

describe('3D panel renderer', () => {
  it('needs a ROS connection', () => {
    expect(() => threeDPanelRenderer.create(makeContext({ ros: null }))).toThrow(/ROS/);
  });

  it('seeds a fresh panel with the robot model and persists it under the desktop key', () => {
    const panel = threeDPanelRenderer.create(makeContext());
    expect(getVisualizationStateForKey(storageKey()).visualizations).toMatchObject([
      { id: 'urdf-panel-1', type: 'urdf', topic: '/robot_description' },
    ]);
    panel.dispose();
  });

  it('does not re-seed a panel whose layers were removed on purpose', () => {
    localStorage.setItem(storageKey(), JSON.stringify({ visualizations: [], fixedFrame: '', displayedTfFrames: [] }));
    const ros = makeRos();
    threeDPanelRenderer.create(makeContext({ ros })).dispose();
    expect(ros.getTopics).not.toHaveBeenCalled();
  });

  it('applies the initial view and skips auto-fit', () => {
    const panel = threeDPanelRenderer.create(
      makeContext({ initialView: { position: [0.1, 0.2, 0], quaternion: [0, 0, 0, 1], scale: 2 } })
    );
    const view = findView(panel);
    expect(view.scale.x).toBe(2);
    expect(view.position.x).toBeCloseTo(0.1);
    panel.update?.({ time: 10_000 } as never);
    expect(view.scale.x).toBe(2);
    panel.dispose();
  });

  it('drives the display host each frame and tolerates TF changes', () => {
    const panel = threeDPanelRenderer.create(makeContext());
    const [display] = host.instances;
    panel.update?.({ time: 42 } as never);
    expect(display.update).toHaveBeenCalledWith(42);
    display.fixedFrame = 'map';
    display.onTfChanged?.();
    panel.dispose();
  });

  it('zooms about the floor centre within limits and saves the view', () => {
    const saveView = vi.fn();
    const panel = threeDPanelRenderer.create(makeContext({ saveView }));
    const view = findView(panel);
    pressToolbar(panel, 'zoom-in');
    expect(view.scale.x).toBeCloseTo(1.25);
    expect(saveView).toHaveBeenCalledOnce();
    for (let index = 0; index < 40; index += 1) view.scale.setScalar(view.scale.x * 1.25);
    pressToolbar(panel, 'reset');
    expect(view.scale.x).toBe(1);
    expect(saveView).toHaveBeenCalledTimes(2);
    panel.dispose();
  });

  it('keeps a grabbed view yaw-only on the floor and inside reach', () => {
    const panel = threeDPanelRenderer.create(makeContext());
    const view = findView(panel);
    const { constrain } = view.userData as { constrain: () => void };
    view.quaternion.setFromEuler(new THREE.Euler(0.6, 1.0, 0.4, 'YXZ'));
    view.position.set(5, 3, 0);
    constrain();
    const euler = new THREE.Euler().setFromQuaternion(view.quaternion, 'YXZ');
    expect(euler.x).toBeCloseTo(0);
    expect(euler.z).toBeCloseTo(0);
    expect(euler.y).toBeCloseTo(1.0);
    expect(view.position.y).toBe(0);
    expect(Math.hypot(view.position.x, view.position.z)).toBeLessThan(0.6);
    panel.dispose();
  });

  it('closes through the frame and reports placement changes from its size buttons', () => {
    const requestClose = vi.fn();
    const savePlacement = vi.fn();
    const panel = threeDPanelRenderer.create(makeContext({ requestClose, savePlacement }));
    pressToolbar(panel, 'frame-larger');
    expect(savePlacement).toHaveBeenCalledOnce();
    pressToolbar(panel, 'close');
    expect(requestClose).toHaveBeenCalledOnce();
    panel.dispose();
  });

  it('lists topics when settings open', () => {
    localStorage.setItem(storageKey(), JSON.stringify({ visualizations: [], fixedFrame: '', displayedTfFrames: [] }));
    const ros = makeRos();
    const panel = threeDPanelRenderer.create(makeContext({ ros }));
    pressToolbar(panel, 'settings');
    expect(ros.getTopics).toHaveBeenCalledOnce();
    pressToolbar(panel, 'settings');
    panel.dispose();
  });

  it('saves a settings change at once but applies it to the scene after a short delay', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ visualizations: [], fixedFrame: '', displayedTfFrames: [] }));
      const panel = threeDPanelRenderer.create(makeContext());
      const [display] = host.instances;
      display.frameNames = ['map', 'odom'];
      display.setState.mockClear();
      pressToolbar(panel, 'settings');
      pressToolbar(panel, 'row-0');
      pressToolbar(panel, 'row-2');
      expect(getVisualizationStateForKey(storageKey()).fixedFrame).toBe('odom');
      expect(display.setState).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(display.setState).toHaveBeenCalledOnce();
      expect(display.setState.mock.calls[0][0].fixedFrame).toBe('odom');
      panel.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a pending scene update when disposed', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ visualizations: [], fixedFrame: '', displayedTfFrames: [] }));
      const panel = threeDPanelRenderer.create(makeContext());
      const [display] = host.instances;
      display.frameNames = ['map'];
      display.setState.mockClear();
      pressToolbar(panel, 'settings');
      pressToolbar(panel, 'row-0');
      pressToolbar(panel, 'row-1');
      panel.dispose();
      vi.advanceTimersByTime(1000);
      expect(display.setState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes its display host once', () => {
    const panel = threeDPanelRenderer.create(makeContext());
    panel.dispose();
    panel.dispose();
    expect(host.instances[0].dispose).toHaveBeenCalledOnce();
    expect(panel.object.parent).toBeNull();
  });
});
