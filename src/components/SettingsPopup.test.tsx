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
    it('opens on the frame list by default and toggles a single frame', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'TF frames' })).toHaveAttribute('aria-expanded', 'true');
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

    it('hides the filter for short lists', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.queryByLabelText('Filter frames')).not.toBeInTheDocument();
    });
  });

  describe('frame display settings', () => {
    it('moves axes, label, link toggles and the size/opacity sliders to their own view', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.queryByLabelText('Axes size')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Frame display settings' }));

      expect(screen.getByRole('heading', { name: 'Frame display' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Fixed Frame:')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Axes size')).toHaveValue('0.5');
      expect(screen.getByLabelText('Label size')).toHaveValue('0.12');
      expect(screen.getByLabelText('Label opacity')).toHaveValue('0.8');
      expect(screen.getByText('80%')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Axes size'), { target: { value: '0.25' } });
      fireEvent.change(screen.getByLabelText('Label size'), { target: { value: '0.3' } });
      fireEvent.change(screen.getByLabelText('Axes opacity'), { target: { value: '0.5' } });
      fireEvent.change(screen.getByLabelText('Label opacity'), { target: { value: '0.35' } });
      fireEvent.click(screen.getByLabelText('Show axes'));
      fireEvent.click(screen.getByLabelText('Show labels'));
      fireEvent.click(screen.getByLabelText('Label background'));
      fireEvent.click(screen.getByLabelText('Show parent links'));

      expect(mockOnTfDisplayChange.mock.calls.map(call => call[0])).toEqual([
        { tfAxesScale: 0.25 },
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

    it('disables the controls of a feature that is switched off', () => {
      render(
        <SettingsPopup
          {...defaultProps}
          tfDisplay={{ ...defaultProps.tfDisplay, showTfAxes: false, showTfFrameLabels: false }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Frame display settings' }));

      expect(screen.getByLabelText('Axes size')).toBeDisabled();
      expect(screen.getByLabelText('Axes opacity')).toBeDisabled();
      expect(screen.getByLabelText('Label size')).toBeDisabled();
      expect(screen.getByLabelText('Label opacity')).toBeDisabled();
      expect(screen.getByLabelText('Label background')).toBeDisabled();
    });
  });

  describe('visualizations section', () => {
    it('is collapsed behind the frame list and expands in its place', () => {
      render(<SettingsPopup {...defaultProps} />);

      expect(screen.queryByText('/points')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /active visualizations/i }));

      expect(screen.getByTitle('/points')).toBeInTheDocument();
      expect(screen.queryByLabelText('odom')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'TF frames' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps the add button reachable while collapsed', () => {
      render(<SettingsPopup {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Add visualization' }));

      expect(mockOnAddVisualizationClick).toHaveBeenCalled();
    });

    it('removes a visualization', () => {
      render(<SettingsPopup {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /active visualizations/i }));

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
      fireEvent.click(screen.getByRole('button', { name: /active visualizations/i }));

      fireEvent.change(screen.getByLabelText('Topic', { selector: '#visualization-topic-viz-1' }), {
        target: { value: '/points_filtered' },
      });

      expect(mockOnUpdateVisualizationTopic).toHaveBeenCalledWith('viz-1', '/points_filtered');
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
      fireEvent.click(screen.getByRole('button', { name: /active visualizations/i }));

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
