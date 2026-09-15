import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VisualizationPanel from './VisualizationPanel';
import { clearVisualizationState } from '../utils/visualizationState';

const viewerLifecycleMock = vi.hoisted(() => ({
  ros3dViewer: { current: null as any },
  viewerGeneration: 0,
}));
const tfProviderLifecycleMock = vi.hoisted(() => ({
  customTFProvider: { current: null as any },
  isProviderReady: false,
  transforms: {},
  availableFrames: ['map', 'odom'],
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
    pointCloudVizMock.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores settings before the initial save when there are no visualizations', () => {
    const savedState = {
      visualizations: [],
      fixedFrame: 'map',
      displayedTfFrames: ['base_link'],
      showTfFrameLabels: false,
      tfAxesScale: 1.2,
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
    fireEvent.click(screen.getByRole('button', { name: /Displayed TF Frames/i }));

    expect(screen.getByLabelText('Fixed Frame:')).toHaveValue('map');
    expect(screen.getByLabelText('TF Axes Size:')).toHaveValue('1.2');
    expect(screen.getByLabelText('Show frame labels')).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('roboboy_3d_visualization_state')!)).toEqual(savedState);
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
    fireEvent.click(screen.getByRole('button', { name: 'Add visualization' }));

    expect(screen.getByRole('heading', { name: 'Add Visualization' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '3D view settings' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('dialog', { name: '3D view settings' })).toBeInTheDocument();
  });
});
