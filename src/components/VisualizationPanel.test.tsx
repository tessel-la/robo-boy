import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VisualizationPanel from './VisualizationPanel';
import { clearVisualizationState } from '../utils/visualizationState';
import { useTfVisualizer } from '../hooks/useTfVisualizer';

const viewerLifecycleMock = vi.hoisted(() => ({
  ros3dViewer: { current: null as any },
  viewerGeneration: 0,
}));
const tfProviderLifecycleMock = vi.hoisted(() => ({
  customTFProvider: { current: null as any },
  isProviderReady: false,
  transforms: {},
  availableFrames: ['map', 'odom'],
  fixedFrame: 'map',
}));
const pointCloudVizMock = vi.hoisted(() => vi.fn(() => null));

vi.mock('../hooks/useRos3dViewer', () => ({
  useRos3dViewer: () => viewerLifecycleMock,
}));

vi.mock('../hooks/useTfProvider', () => ({
  useTfProvider: () => tfProviderLifecycleMock,
}));

vi.mock('../hooks/useTfVisualizer', () => ({
  useTfVisualizer: vi.fn(),
}));

vi.mock('./visualizers/PointCloudViz', () => ({
  default: pointCloudVizMock,
}));

describe('VisualizationPanel state restoration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearVisualizationState();
    localStorage.clear();
    viewerLifecycleMock.ros3dViewer.current = null;
    viewerLifecycleMock.viewerGeneration = 0;
    tfProviderLifecycleMock.customTFProvider.current = null;
    tfProviderLifecycleMock.isProviderReady = false;
    tfProviderLifecycleMock.availableFrames = ['map', 'odom'];
    pointCloudVizMock.mockClear();
    (useTfVisualizer as any).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores settings before the initial save when there are no visualizations', () => {
    const savedState = {
      visualizations: [],
      fixedFrame: 'map',
      displayedTfFrames: ['odom'],
      showAllTfFrames: false,
      showTfAxes: true,
      showTfFrameLabels: false,
      showTfConnections: false,
      tfAxesScale: 1.2,
      tfLabelScale: 0.3,
      tfAxesOpacity: 0.6,
      tfLabelOpacity: 0.7,
      showTfLabelBackground: false,
    };
    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(savedState));

    const ros = {
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: [], types: [] });
      },
    };

    render(<VisualizationPanel ros={ros as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByLabelText('Fixed Frame:')).toHaveValue('map');
    expect(screen.getByLabelText('odom')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Frame display settings' }));
    expect(screen.getByLabelText('Axes size in metres')).toHaveValue(1.2);
    expect(screen.getByLabelText('Label size in metres')).toHaveValue(0.3);
    expect(screen.getByLabelText('Axes opacity')).toHaveValue('0.6');
    expect(screen.getByLabelText('Label opacity')).toHaveValue('0.7');
    expect(screen.getByLabelText('Show labels')).not.toBeChecked();
    expect(screen.getByLabelText('Label background')).not.toBeChecked();
    expect(screen.getByLabelText('Show parent links')).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('roboboy_3d_visualization_state')!)).toEqual(savedState);
  });

  it('shows every live frame while "show all" is on and clears them when it is switched off', () => {
    const ros = {
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: [], types: [] });
      },
    };
    const visualizedFrames = () => (useTfVisualizer as any).mock.calls.at(-1)[0].displayedTfFrames;

    const { rerender } = render(<VisualizationPanel ros={ros as any} storageKey="show-all" />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByLabelText('Show all frames'));
    expect(visualizedFrames()).toEqual(['map', 'odom']);
    expect(screen.getByLabelText('map')).toBeChecked();

    // A frame that appears later is added without touching the settings. (The panel is memoized,
    // so a fresh ros identity stands in for the provider re-rendering it.)
    tfProviderLifecycleMock.availableFrames = ['base_link', 'map', 'odom'];
    rerender(<VisualizationPanel ros={{ ...ros } as any} storageKey="show-all" />);
    expect(visualizedFrames()).toEqual(['base_link', 'map', 'odom']);
    expect(screen.getByText('3/3')).toBeInTheDocument();

    // Unchecking one frame leaves "all" mode with the remaining subset.
    fireEvent.click(screen.getByLabelText('odom'));
    expect(screen.getByLabelText('Show all frames')).not.toBeChecked();
    expect(visualizedFrames()).toEqual(['base_link', 'map']);

    fireEvent.click(screen.getByLabelText('Show all frames'));
    fireEvent.click(screen.getByLabelText('Show all frames'));
    expect(visualizedFrames()).toEqual([]);
    expect(screen.getByText('0/3')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('show-all')!)).toMatchObject({
      showAllTfFrames: false,
      displayedTfFrames: [],
    });
  });

  it('gives every mounted viewer its own DOM target', () => {
    const ros = {
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: [], types: [] });
      },
    };

    const { container } = render(
      <>
        <VisualizationPanel ros={ros as any} storageKey="viewer-one" />
        <VisualizationPanel ros={ros as any} storageKey="viewer-two" />
      </>
    );
    const viewerIds = Array.from(container.querySelectorAll('.viewer-container')).map(element => element.id);

    expect(viewerIds).toHaveLength(2);
    expect(new Set(viewerIds).size).toBe(2);
    expect(viewerIds.every(id => id.startsWith('ros3d-viewer-'))).toBe(true);
  });

  it('mounts restored visualizers after delayed viewer and TF provider readiness', () => {
    const savedState = {
      visualizations: [{ id: 'points', type: 'pointcloud', topic: '/points' }],
      fixedFrame: 'odom',
      displayedTfFrames: [],
      showFrameLabels: true,
      tfAxesScale: 0.1,
    };
    localStorage.setItem('delayed-viewer', JSON.stringify(savedState));
    const createRos = () => ({
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: ['/points'], types: ['sensor_msgs/msg/PointCloud2'] });
      },
    });

    const { rerender } = render(<VisualizationPanel ros={createRos() as any} storageKey="delayed-viewer" />);
    expect(pointCloudVizMock).not.toHaveBeenCalled();

    viewerLifecycleMock.ros3dViewer.current = { scene: {} };
    viewerLifecycleMock.viewerGeneration = 1;
    tfProviderLifecycleMock.customTFProvider.current = {};
    tfProviderLifecycleMock.isProviderReady = true;
    rerender(<VisualizationPanel ros={createRos() as any} storageKey="delayed-viewer" />);

    expect(pointCloudVizMock).toHaveBeenCalled();
  });

  it('registers an assistant bridge that reports and changes what the scene shows', () => {
    tfProviderLifecycleMock.availableFrames = ['base_link', 'map', 'odom'];
    const ros = {
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: ['/robot_description', '/scan'], types: ['std_msgs/msg/String', 'sensor_msgs/msg/LaserScan'] });
      },
    };
    const register = vi.fn();
    const { unmount } = render(<VisualizationPanel ros={ros as any} storageKey="bridge" panelId="p3d" onRegisterAssistantBridge={register} />);
    const bridge = register.mock.calls[0][1];
    expect(register).toHaveBeenCalledWith('p3d', expect.objectContaining({ panelType: '3d' }));

    expect(bridge.describe()).toMatchObject({ fixedFrame: 'map', displayedTfFrames: [], showAllTfFrames: false, visualizations: [] });
    expect(bridge.describe().availableVisualizationTopics).toMatchObject({ urdf: ['/robot_description'], laserscan: ['/scan'], pointcloud: [] });

    let outcomes: Array<{ ok: boolean; message: string }> = [];
    act(() => {
      outcomes = bridge.apply({
        fixedFrame: 'odom',
        showTfFrames: ['base_link', 'ghost'],
        tfDisplay: { showTfFrameLabels: false, tfAxesScale: 0.3, bogus: 1 },
        addVisualizations: [{ type: 'urdf' }, { type: 'pointcloud' }],
      });
    });
    expect(outcomes).toEqual([
      { ok: true, message: 'Fixed frame set to odom.' },
      { ok: true, message: 'Showing base_link.' },
      { ok: false, message: 'No TF frame named ghost.' },
      { ok: true, message: 'Frame display updated (showTfFrameLabels, tfAxesScale).' },
      { ok: false, message: 'Ignored unknown or invalid frame display keys: bogus.' },
      { ok: true, message: 'Added urdf on /robot_description.' },
      { ok: false, message: 'No topic on this robot can feed a pointcloud visualization.' },
    ]);
    const visualized = (useTfVisualizer as any).mock.calls.at(-1)[0];
    expect(visualized).toMatchObject({ displayedTfFrames: ['base_link'], showFrameLabels: false, axesScale: 0.3 });
    expect(bridge.describe()).toMatchObject({ displayedTfFrames: ['base_link'], visualizations: [{ type: 'urdf', topic: '/robot_description' }] });

    act(() => {
      outcomes = bridge.apply({ removeVisualizations: [{ type: 'urdf' }], showAllTfFrames: true });
    });
    expect(outcomes).toEqual([
      { ok: true, message: 'Showing every TF frame.' },
      { ok: true, message: 'Removed urdf on /robot_description.' },
    ]);
    expect(bridge.describe()).toMatchObject({ showAllTfFrames: true, displayedTfFrames: ['base_link', 'map', 'odom'], visualizations: [] });

    unmount();
    expect(register).toHaveBeenLastCalledWith('p3d', null);
  });

  it('keeps add visualization inside the shared settings menu', () => {
    const ros = {
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: [], types: [] });
      },
    };

    render(<VisualizationPanel ros={ros as any} />);
    expect(screen.queryByRole('button', { name: 'Add visualization' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: /active visualizations/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add visualization' }));

    expect(screen.getByRole('heading', { name: 'Add Visualization' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '3D view settings' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('dialog', { name: '3D view settings' })).toBeInTheDocument();
  });
});
