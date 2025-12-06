// ros3d module barrel export - Provides backward-compatible API
import { Viewer } from './Viewer';
import { Grid, Axes } from './primitives';
import { PointCloud2, LaserScan } from './visualizers';
import { OrbitControls } from './controls';
import { UrdfClient } from './UrdfClient';

// Export as default and named exports to match the original module
const ROS3D = {
    Viewer,
    Grid,
    Axes,
    PointCloud2,
    LaserScan,
    OrbitControls,
    UrdfClient,
};

// Named exports for tree-shaking
export { Viewer } from './Viewer';
export { Grid, Axes } from './primitives';
export { PointCloud2, LaserScan } from './visualizers';
export { OrbitControls } from './controls';
export { UrdfClient } from './UrdfClient';

// Default export for backward compatibility
export default ROS3D;
