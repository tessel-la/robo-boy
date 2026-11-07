import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import NavigationLayerSettings from './NavigationLayerSettings';
it('keeps existing maps unchanged and exposes independent palette and compatible update-topic choices', () => {
  const change = vi.fn();
  render(
    <NavigationLayerSettings
      id="map"
      type="occupancygrid"
      topic="/global/costmap"
      topics={[
        { name: '/global/costmap_updates', type: 'map_msgs/msg/OccupancyGridUpdate' },
        { name: '/local/costmap_updates', type: 'map_msgs/OccupancyGridUpdate' },
        { name: '/wrong', type: 'std_msgs/msg/String' },
      ]}
      onChange={change}
    />
  );
  const palette = screen.getByLabelText('Color scheme for Occupancy grid on /global/costmap');
  const updates = screen.getByLabelText('Updates topic for Occupancy grid on /global/costmap');
  expect(palette).toHaveValue('occupancy');
  expect(updates).toHaveValue('');
  expect(screen.queryByRole('option', { name: '/wrong' })).not.toBeInTheDocument();
  fireEvent.change(palette, { target: { value: 'costmap' } });
  expect(change).toHaveBeenLastCalledWith('map', { palette: 'costmap' });
  fireEvent.change(updates, { target: { value: '/global/costmap_updates' } });
  expect(change).toHaveBeenLastCalledWith('map', { updatesTopic: '/global/costmap_updates' });
});
it('preserves saved topics before discovery and keeps map-only controls out of paths', () => {
  const view = render(
    <NavigationLayerSettings
      id="map"
      type="occupancygrid"
      topic="/map"
      options={{ updatesTopic: '/map_updates', palette: 'costmap' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByRole('option', { name: '/map_updates (current)' })).toBeInTheDocument();
  expect(screen.getByText(/inscribed 99/)).toBeInTheDocument();
  view.rerender(<NavigationLayerSettings id="path" type="path" topic="/plan" onChange={vi.fn()} />);
  expect(screen.queryByText('Updates topic')).not.toBeInTheDocument();
});
