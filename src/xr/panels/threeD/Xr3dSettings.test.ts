import type { Ros } from 'roslib';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VISUALIZATION_STATE, type VisualizationPanelState } from '../../../utils/visualizationState';
import { stubCanvasContext } from '../../ui/canvasStub';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { SurfaceInteraction } from '../../ui/SurfaceInteraction';
import type { XrInputTarget } from '../../XrInputManager';
import { Xr3dSettings } from './Xr3dSettings';

beforeAll(stubCanvasContext);

const TOPICS = {
  topics: ['/robot_description', '/scan', '/points', '/chatter'],
  types: ['std_msgs/msg/String', 'sensor_msgs/msg/LaserScan', 'sensor_msgs/msg/PointCloud2', 'std_msgs/msg/String'],
};

const build = (initial: Partial<VisualizationPanelState> = {}, fail = false) => {
  let state: VisualizationPanelState = { ...DEFAULT_VISUALIZATION_STATE, ...initial };
  const menu = new SpatialMenu({ pageSize: 8 });
  const ros = {
    getTopics: vi.fn((ok: (result: typeof TOPICS) => void, error: () => void) => (fail ? error() : ok(TOPICS))),
  } as unknown as Ros;
  const commit = vi.fn((next: VisualizationPanelState) => {
    state = next;
    menu.refresh();
  });
  const settings = new Xr3dSettings({
    menu,
    ros,
    getState: () => state,
    commit,
    getFrameNames: () => ['map', 'base_link'],
    getFixedFrame: () => 'map',
  });
  const interaction = new SurfaceInteraction();
  const press = (id: string) => {
    const item = menu.surface.getItem(id);
    if (!item) throw new Error(`no item ${id}`);
    interaction.activate({
      object: menu.surface.mesh,
      uv: new THREE.Vector2(
        (item.x + item.w / 2) / menu.surface.pixelWidth,
        1 - (item.y + item.h / 2) / menu.surface.pixelHeight
      ),
    } as unknown as XrInputTarget);
  };
  return { settings, menu, ros, commit, press, getState: () => state };
};

describe('Xr3dSettings', () => {
  it('opens the root page and loads topics once', () => {
    const { settings, menu, ros } = build();
    settings.open();
    expect(menu.isOpen).toBe(true);
    expect(ros.getTopics).toHaveBeenCalledOnce();
  });

  it('picks a fixed frame and returns to the root', () => {
    const { settings, press, commit, getState, menu } = build();
    settings.open();
    press('row-0');
    press('row-2');
    expect(commit).toHaveBeenCalledOnce();
    expect(getState().fixedFrame).toBe('base_link');
    expect(menu.surface.getItem('back')).toBeNull();
    press('row-0');
    press('row-0');
    expect(getState().fixedFrame).toBe('');
  });

  it('adds a layer from a compatible topic only, then returns to the layer list', () => {
    const { settings, press, getState, menu } = build();
    settings.open();
    press('row-1');
    press('row-0');
    // Add layer page: point cloud is the first type and only /points is compatible with it.
    press('row-0');
    expect(menu.surface.getItem('row-0')).not.toBeNull();
    expect(menu.surface.getItem('row-1')).toBeNull();
    press('row-0');
    expect(getState().visualizations).toHaveLength(1);
    expect(getState().visualizations[0]).toMatchObject({ type: 'pointcloud', topic: '/points', options: {} });
    // Two pops land on the layer list, which now has Add layer plus the new layer.
    expect(menu.surface.getItem('row-1')).not.toBeNull();
  });

  it('binds a robot model layer to its description topic', () => {
    const { settings, press, getState } = build();
    settings.open();
    press('row-1');
    press('row-0');
    press('row-2');
    press('row-0');
    expect(getState().visualizations[0]).toMatchObject({
      type: 'urdf',
      topic: '/robot_description',
      options: { robotDescriptionTopic: '/robot_description' },
    });
  });

  it('steps a layer option within its bounds and removes the layer from its page', () => {
    const { settings, press, getState } = build({
      visualizations: [{ id: 'l1', type: 'laserscan', topic: '/scan', options: { pointSize: 0.5 } }],
    });
    settings.open();
    press('row-1');
    press('row-1');
    press('row-1:inc');
    expect(getState().visualizations[0].options).toEqual({ pointSize: 0.75 });
    press('row-1:dec');
    press('row-1:dec');
    expect(getState().visualizations[0].options).toEqual({ pointSize: 0.25 });
    // At the minimum the decrement is disabled and must not commit.
    const before = getState();
    press('row-1:dec');
    expect(getState()).toBe(before);
    press('row-2');
    expect(getState().visualizations).toEqual([]);
  });

  it('removes a layer from the list with its secondary button', () => {
    const { settings, press, getState } = build({
      visualizations: [{ id: 'l1', type: 'laserscan', topic: '/scan', options: {} }],
    });
    settings.open();
    press('row-1');
    press('row-1:secondary');
    expect(getState().visualizations).toEqual([]);
  });

  it('toggles TF display options', () => {
    const { settings, press, getState } = build({ showTfAxes: true });
    settings.open();
    press('row-2');
    press('row-2');
    expect(getState().showTfAxes).toBe(false);
    press('row-0');
    expect(getState().showAllTfFrames).toBe(true);
  });

  it('shows a failure message when topics cannot be listed', () => {
    const { settings, press, menu } = build({}, true);
    settings.open();
    press('row-1');
    press('row-0');
    press('row-0');
    expect(menu.surface.getItem('empty')).not.toBeNull();
  });
});
