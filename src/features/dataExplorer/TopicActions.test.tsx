import { expect, it } from 'vitest';
import { viewFor } from './TopicActions';

it.each([
  ['nav_msgs/Path', 'path'],
  ['nav_msgs/msg/Path', 'path'],
  ['nav_msgs/OccupancyGrid', 'occupancygrid'],
  ['nav_msgs/msg/OccupancyGrid', 'occupancygrid'],
])('opens %s in its matching 3D layer', (type, visualizationType) => {
  expect(viewFor(type)).toEqual({ panel: '3d', visualizationType });
});

it('does not offer a full-grid visualization for incremental updates', () => {
  expect(viewFor('map_msgs/msg/OccupancyGridUpdate')).toBeNull();
});
