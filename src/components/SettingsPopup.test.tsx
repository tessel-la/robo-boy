import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SettingsPopup from './SettingsPopup';

describe('SettingsPopup', () => {
  const mockOnClose = vi.fn();
  const mockOnFixedFrameChange = vi.fn();
  const mockOnDisplayedTfFramesChange = vi.fn();
  const mockOnShowAllTfFramesChange = vi.fn();
  const mockOnRemoveVisualization = vi.fn();
  const mockOnAddVisualizationClick = vi.fn();
  const mockOnTfDisplayChange = vi.fn();
  const mockOnUpdateVisualizationTopic = vi.fn();

  const defaultProps = {
    onClose: mockOnClose,
    fixedFrame: 'base_link',
    availableFrames: ['base_link', 'odom', 'map'],
    onFixedFrameChange: mockOnFixedFrameChange,
    displayedTfFrames: ['base_link'],
    onDisplayedTfFramesChange: mockOnDisplayedTfFramesChange,
    showAllTfFrames: false,
    onShowAllTfFramesChange: mockOnShowAllTfFramesChange,
    tfDisplay: {
      showTfAxes: true,
      showTfFrameLabels: true,
      showTfConnections: true,
      tfAxesScale: 0.5,
      tfAxesWidth: 0.003,
      tfLabelScale: 0.12,
      tfAxesOpacity: 1,
      tfLabelOpacity: 0.8,
      showTfLabelBackground: true,
    },
    onTfDisplayChange: mockOnTfDisplayChange,
    activeVisualizations: [
      { id: 'viz-1', type: 'pointcloud' as const, topic: '/points' },
      { id: 'viz-2', type: 'laserscan' as const, topic: '/scan' },
    ],
    onRemoveVisualization: mockOnRemoveVisualization,
    onAddVisualizationClick: mockOnAddVisualizationClick,
    onUpdateVisualizationTopic: mockOnUpdateVisualizationTopic,
    allTopics: [
      { name: '/points', type: 'sensor_msgs/PointCloud2' },
      { name: '/scan', type: 'sensor_msgs/LaserScan' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('places camera calibration, image-plane and synchronization controls under the camera layer', () => {
    const update = vi.fn();
    render(<SettingsPopup {...defaultProps} onUpdateVisualizationOptions={update}
      activeVisualizations={[{ id: 'cam', type: 'cameraimage', topic: '/front/image_rect/compressed' }]}
      allTopics={[{ name: '/front/camera_info', type: 'sensor_msgs/msg/CameraInfo' }]} />);
    fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));
    fireEvent.click(screen.getByLabelText('Edit Camera image visualization for topic /front/image_rect/compressed'));
    expect(screen.getByRole('heading', { name: '/front/image_rect/compressed' })).toBeInTheDocument();
    expect(screen.getByLabelText('Image source for Camera image on /front/image_rect/compressed')).toHaveValue('stream');
    expect(screen.getByRole('option', { name: 'Camera streamer' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Image source for Camera image on /front/image_rect/compressed'), { target: { value: 'ros' } });
    expect(update).toHaveBeenLastCalledWith('cam', { imageSource: 'ros' });
    expect(screen.getByLabelText('CameraInfo topic for Camera image on /front/image_rect/compressed')).toHaveValue('/front/camera_info');
    expect(screen.getByLabelText('Image geometry for Camera image on /front/image_rect/compressed')).toHaveValue('rectified');
    expect(screen.getByLabelText('Image plane distance in metres for Camera image on /front/image_rect/compressed')).toHaveValue(1);
    fireEvent.change(screen.getByLabelText('Image opacity for Camera image on /front/image_rect/compressed'), { target: { value: '0.4' } });
    expect(update).toHaveBeenLastCalledWith('cam', { opacity: 0.4 });
    fireEvent.click(screen.getByLabelText('Show frustum for Camera image on /front/image_rect/compressed'));
    expect(update).toHaveBeenLastCalledWith('cam', { showFrustum: false });
  });

  it('offers independent path/map visibility and appearance controls', () => {
    const onUpdate = vi.fn();
    render(<SettingsPopup {...defaultProps} onUpdateVisualizationOptions={onUpdate} activeVisualizations={[
      { id: 'plan', type: 'path', topic: '/robot/plan', options: { color: '#123456', lineWidth: 0.05, opacity: 0.4 } },
      { id: 'map', type: 'occupancygrid', topic: '/robot/map', options: { visible: false } },
    ]} />);
    fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));
    fireEvent.click(screen.getByLabelText('Edit Path visualization for topic /robot/plan'));
    expect(screen.getByLabelText('Color for Path on /robot/plan')).toHaveValue('#123456');
    expect(screen.getByLabelText('Line width in metres for Path on /robot/plan')).toHaveValue(0.05);
    expect(screen.getByLabelText('Opacity for Path on /robot/plan')).toHaveValue('0.4');
    fireEvent.click(screen.getByLabelText('Show Path on /robot/plan'));
    expect(onUpdate).toHaveBeenLastCalledWith('plan', { visible: false });

    fireEvent.click(screen.getByLabelText('Back to 3D view settings'));
    fireEvent.click(screen.getByLabelText('Edit Occupancy grid visualization for topic /robot/map'));
    expect(screen.getByLabelText('Show Occupancy grid on /robot/map')).not.toBeChecked();
    expect(screen.getByLabelText('Opacity for Occupancy grid on /robot/map')).toHaveValue('0.7');
    expect(screen.queryByLabelText('Color for Occupancy grid on /robot/map')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Opacity for Occupancy grid on /robot/map'), { target: { value: '0' } });
    expect(onUpdate).toHaveBeenLastCalledWith('map', { opacity: 0 });
  });

  describe('fixed frame selection', () => {
    it('shows the frame in use, selected automatically, and lets the user pick another', () => {
      render(<SettingsPopup {...defaultProps} fixedFrame="map" />);

      const select = screen.getByLabelText('Fixed Frame:');
      expect(select).toHaveValue('map');
      expect(select).not.toHaveTextContent(/auto/i);

      fireEvent.change(select, { target: { value: 'odom' } });
      expect(mockOnFixedFrameChange).toHaveBeenCalled();
    });

    it('is disabled with an explanatory option before any TF frame exists', () => {
      render(<SettingsPopup {...defaultProps} fixedFrame="map" availableFrames={[]} />);

      const select = screen.getByLabelText('Fixed Frame:');
      expect(select).toBeDisabled();
      expect(select).toHaveTextContent('No frames available');
    });
  });

  describe('TF frames section', () => {
    it('opens on the Frames tab by default and toggles a single frame', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.getByRole('tab', { name: /Frames/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('1/3')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('odom'));

      expect(mockOnDisplayedTfFramesChange).toHaveBeenCalledWith(['base_link', 'odom']);
    });

    it('has a show-all toggle', () => {
      render(<SettingsPopup {...defaultProps} />);

      fireEvent.click(screen.getByLabelText('Show all frames'));

      expect(mockOnShowAllTfFramesChange).toHaveBeenCalledWith(true);
    });

    it('filters a long frame list without changing the selection', () => {
      const availableFrames = ['base_link', 'camera_link', 'camera_optical', 'lidar', 'map', 'odom', 'wheel_left'];
      render(<SettingsPopup {...defaultProps} availableFrames={availableFrames} />);

      fireEvent.change(screen.getByLabelText('Filter frames'), { target: { value: 'CAM' } });

      expect(screen.getAllByRole('checkbox', { name: /link|optical|map|odom|lidar|wheel/ })).toHaveLength(2);
      expect(screen.getByLabelText('camera_link')).toBeInTheDocument();
      expect(screen.queryByLabelText('map')).not.toBeInTheDocument();
      expect(mockOnDisplayedTfFramesChange).not.toHaveBeenCalled();
    });

    it('disables the filter until there are frames to filter', () => {
      render(<SettingsPopup {...defaultProps} availableFrames={[]} />);

      expect(screen.getByLabelText('Filter frames')).toBeDisabled();
    });
  });

  describe('frame display settings', () => {
    it('moves axes, label, link toggles and the size/opacity sliders to their own view', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.queryByLabelText('Axes length')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Frame display settings' }));

      expect(screen.getByRole('heading', { name: 'Frame display' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Fixed Frame:')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Axes length in metres')).toHaveValue(0.5);
      expect(screen.getByLabelText('Axes width in metres')).toHaveValue(0.003);
      expect(screen.getByLabelText('Label size in metres')).toHaveValue(0.12);
      expect(screen.getByLabelText('Label opacity')).toHaveValue('0.8');
      expect(screen.getByText('80%')).toBeInTheDocument();

      // Typed values commit on blur/Enter, clamped to the field's range.
      fireEvent.change(screen.getByLabelText('Axes length in metres'), { target: { value: '0.25' } });
      fireEvent.blur(screen.getByLabelText('Axes length in metres'));
      fireEvent.change(screen.getByLabelText('Axes width in metres'), { target: { value: '0.006' } });
      fireEvent.blur(screen.getByLabelText('Axes width in metres'));
      fireEvent.change(screen.getByLabelText('Label size in metres'), { target: { value: '0.3' } });
      fireEvent.keyDown(screen.getByLabelText('Label size in metres'), { key: 'Enter' });
      fireEvent.change(screen.getByLabelText('Axes opacity'), { target: { value: '0.5' } });
      fireEvent.change(screen.getByLabelText('Label opacity'), { target: { value: '0.35' } });
      fireEvent.click(screen.getByLabelText('Show axes'));
      fireEvent.click(screen.getByLabelText('Show labels'));
      fireEvent.click(screen.getByLabelText('Label background'));
      fireEvent.click(screen.getByLabelText('Show parent links'));

      expect(mockOnTfDisplayChange.mock.calls.map(call => call[0])).toEqual([
        { tfAxesScale: 0.25 },
        { tfAxesWidth: 0.006 },
        { tfLabelScale: 0.3 },
        { tfAxesOpacity: 0.5 },
        { tfLabelOpacity: 0.35 },
        { showTfAxes: false },
        { showTfFrameLabels: false },
        { showTfLabelBackground: false },
        { showTfConnections: false },
      ]);

      fireEvent.click(screen.getByRole('button', { name: 'Back to 3D view settings' }));
      expect(screen.getByLabelText('Fixed Frame:')).toBeInTheDocument();
    });

    it('gives the size sliders a logarithmic travel so centimetre values are reachable', () => {
      render(<SettingsPopup {...defaultProps} tfDisplay={{ ...defaultProps.tfDisplay, tfAxesScale: 0.01 }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Frame display settings' }));

      const slider = screen.getByLabelText('Axes length');
      expect(slider).toHaveValue('0');
      fireEvent.change(slider, { target: { value: '500' } });
      // Halfway along a 0.01–5 m log scale is sqrt(0.05) ≈ 0.224 m, not 2.5 m.
      expect(mockOnTfDisplayChange).toHaveBeenLastCalledWith({ tfAxesScale: 0.224 });

      fireEvent.change(screen.getByLabelText('Axes length in metres'), { target: { value: '9' } });
      fireEvent.blur(screen.getByLabelText('Axes length in metres'));
      expect(mockOnTfDisplayChange).toHaveBeenLastCalledWith({ tfAxesScale: 5 });
    });

    it('disables the controls of a feature that is switched off', () => {
      render(
        <SettingsPopup
          {...defaultProps}
          tfDisplay={{ ...defaultProps.tfDisplay, showTfAxes: false, showTfFrameLabels: false }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Frame display settings' }));

      expect(screen.getByLabelText('Axes length')).toBeDisabled();
      expect(screen.getByLabelText('Axes length in metres')).toBeDisabled();
      expect(screen.getByLabelText('Axes opacity')).toBeDisabled();
      expect(screen.getByLabelText('Axes width in metres')).toBeDisabled();
      expect(screen.getByLabelText('Label size')).toBeDisabled();
      expect(screen.getByLabelText('Label opacity')).toBeDisabled();
      expect(screen.getByLabelText('Label background')).toBeDisabled();
    });
  });

  describe('visualizations section', () => {
    it('lives on its own tab so each list gets the whole menu height', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.queryByText('/points')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));

      expect(screen.getByRole('tab', { name: /Visualizations/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTitle('/points')).toBeInTheDocument();
      expect(screen.queryByLabelText('odom')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: /Frames/ }));
      expect(screen.getByLabelText('odom')).toBeInTheDocument();
      expect(screen.queryByTitle('/points')).not.toBeInTheDocument();
    });

    it('adds a visualization from a row at the top of the list', () => {
      render(<SettingsPopup {...defaultProps} />);
      expect(screen.queryByRole('button', { name: 'Add visualization' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));

      fireEvent.click(screen.getByRole('button', { name: 'Add visualization' }));

      expect(mockOnAddVisualizationClick).toHaveBeenCalled();
    });

    it('removes a visualization', () => {
      render(<SettingsPopup {...defaultProps} />);
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));

      fireEvent.click(screen.getByRole('button', { name: 'Remove Point Cloud visualization for topic /points' }));

      expect(mockOnRemoveVisualization).toHaveBeenCalledWith('viz-1');
    });

    it('updates a visualization from its contained topic selector', () => {
      render(
        <SettingsPopup
          {...defaultProps}
          allTopics={[
            { name: '/points', type: 'sensor_msgs/PointCloud2' },
            { name: '/points_filtered', type: 'sensor_msgs/msg/PointCloud2' },
          ]}
        />
      );
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));

      fireEvent.change(screen.getByLabelText('Topic', { selector: '#visualization-topic-viz-1' }), {
        target: { value: '/points_filtered' },
      });

      expect(mockOnUpdateVisualizationTopic).toHaveBeenCalledWith('viz-1', '/points_filtered');
    });

    it('offers mesh opacity on each URDF and mesh-marker layer independently', () => {
      const update = vi.fn();
      render(<SettingsPopup {...defaultProps} onUpdateVisualizationOptions={update}
        activeVisualizations={[
          { id: 'robot', type: 'urdf', topic: '/robot_description', options: { opacity: 0.4 } },
          { id: 'objects', type: 'markerarray', topic: '/objects' },
          { id: 'cloud', type: 'pointcloud', topic: '/points' },
        ]} />);
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));
      fireEvent.click(screen.getByLabelText('Edit URDF visualization for topic /robot_description'));
      expect(screen.getByLabelText('Mesh opacity for URDF on /robot_description')).toHaveValue('0.4');
      expect(screen.getAllByRole('slider')).toHaveLength(1);
      fireEvent.change(screen.getByLabelText('Mesh opacity for URDF on /robot_description'), { target: { value: '0' } });
      expect(update).toHaveBeenCalledWith('robot', { opacity: 0 });

      fireEvent.click(screen.getByLabelText('Back to 3D view settings'));
      fireEvent.click(screen.getByLabelText('Edit Mesh markers visualization for topic /objects'));
      expect(screen.getByLabelText('Mesh opacity for Mesh markers on /objects')).toHaveValue('1');
    });

    it('opens each layer\'s settings as a view of the menu and keeps the list compact', () => {
      const update = vi.fn();
      render(<SettingsPopup {...defaultProps} onUpdateVisualizationOptions={update}
        visualizationStatus={{ cloud: 'Waiting for point cloud messages.' }}
        activeVisualizations={[
          { id: 'cloud', type: 'pointcloud', topic: '/points' },
          { id: 'scan', type: 'laserscan', topic: '/scan' },
          { id: 'goal', type: 'posestamped', topic: '/goal_pose' },
          { id: 'info', type: 'camerainfo', topic: '/camera/camera_info' },
        ]} />);
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));

      expect(screen.queryAllByRole('slider')).toHaveLength(0);
      expect(screen.queryByLabelText(/Edit Camera Info/)).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Waiting for point cloud messages.');

      fireEvent.click(screen.getByLabelText('Edit Point Cloud visualization for topic /points'));
      expect(screen.getByText('Point Cloud', { selector: '.settings-popup-kicker' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Waiting for point cloud messages.');
      fireEvent.change(screen.getByLabelText('Color for Point cloud on /points'), { target: { value: '#112233' } });
      expect(update).toHaveBeenLastCalledWith('cloud', { color: '#112233', colorEnabled: true });
      expect(mockOnClose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByLabelText('Back to 3D view settings'));
      expect(screen.getByRole('tab', { name: /Visualizations/ })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByLabelText('Edit Laser Scan visualization for topic /scan'));
      expect(screen.getByLabelText('Point size in pixels for Laser scan on /scan')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Back to 3D view settings'));
      fireEvent.click(screen.getByLabelText('Edit Pose Stamped visualization for topic /goal_pose'));
      expect(screen.getByLabelText('Shape for Pose on /goal_pose')).toHaveValue('arrow');
    });

    it('returns to the list when the layer being edited is removed', () => {
      const props = { ...defaultProps, onUpdateVisualizationOptions: vi.fn() };
      const { rerender } = render(<SettingsPopup {...props}
        activeVisualizations={[{ id: 'cloud', type: 'pointcloud', topic: '/points' }]} />);
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));
      fireEvent.click(screen.getByLabelText('Edit Point Cloud visualization for topic /points'));

      rerender(<SettingsPopup {...props} activeVisualizations={[]} />);
      expect(screen.getByText('No active visualizations.')).toBeInTheDocument();
    });

    it('does not offer unrelated String topics for an active URDF visualization', () => {
      render(
        <SettingsPopup
          {...defaultProps}
          activeVisualizations={[{ id: 'urdf-1', type: 'urdf', topic: '/robot_description' }]}
          allTopics={[
            { name: '/behavior/status', type: 'std_msgs/msg/String' },
            { name: '/robot_description', type: 'std_msgs/msg/String' },
            { name: '/robot_2/robot_description', type: 'std_msgs/String' },
          ]}
        />
      );
      fireEvent.click(screen.getByRole('tab', { name: /Visualizations/ }));

      const selector = screen.getByTitle('/robot_description');
      expect(selector).toHaveTextContent('/robot_description');
      expect(selector).toHaveTextContent('/robot_2/robot_description');
      expect(selector).not.toHaveTextContent('/behavior/status');
    });
  });

  it('closes from the header', () => {
    render(<SettingsPopup {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(mockOnClose).toHaveBeenCalled();
  });
});
