import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddVisualizationModal from './AddVisualizationModal';

const topics = [
  { name: '/points', type: 'sensor_msgs/msg/PointCloud2' },
  { name: '/pose', type: 'geometry_msgs/msg/PoseStamped' },
  { name: '/robot_description', type: 'std_msgs/String' },
];

describe('AddVisualizationModal', () => {
  const onClose = vi.fn();
  const onAddVisualization = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns null when closed', () => {
    const { container } = render(
      <AddVisualizationModal isOpen={false} onClose={onClose} onAddVisualization={onAddVisualization} allTopics={topics} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('quick-adds visualizations from compatible topics', () => {
    render(<AddVisualizationModal isOpen onClose={onClose} onAddVisualization={onAddVisualization} allTopics={topics} />);

    fireEvent.click(screen.getByRole('button', { name: /pointcloud/i }));

    expect(onAddVisualization).toHaveBeenCalledWith({ type: 'pointcloud', topic: '/points', options: {} });
  });

  it('supports advanced manual topic entry', () => {
    render(<AddVisualizationModal isOpen onClose={onClose} onAddVisualization={onAddVisualization} allTopics={topics} />);

    fireEvent.click(screen.getByText('Advanced (customize options)'));
    fireEvent.change(screen.getByLabelText('Visualization Type:'), { target: { value: 'posestamped' } });
    fireEvent.click(screen.getByText('Enter topic manually'));
    fireEvent.change(screen.getByPlaceholderText(/enter posestamped topic/i), { target: { value: '/manual_pose' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Visualization' }));

    expect(onAddVisualization).toHaveBeenCalledWith({ type: 'posestamped', topic: '/manual_pose', options: {} });
  });

  it('closes from the backdrop and close button without closing inner clicks', () => {
    const { container } = render(
      <AddVisualizationModal isOpen onClose={onClose} onAddVisualization={onAddVisualization} allTopics={topics} />
    );

    fireEvent.click(screen.getByRole('heading', { name: 'Add Visualization' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
