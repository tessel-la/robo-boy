import { getUrdfTopics, type RosTopicInfo } from './urdfTopics';
import { RAW_IMAGE_TYPES, COMPRESSED_IMAGE_TYPES } from './images/imageFrames';

/** Visualization types that bind to a topic; TF is driven by the frame list instead. */
export type TopicVisualizationType = 'pointcloud' | 'camerainfo' | 'urdf' | 'laserscan' | 'posestamped' | 'markerarray' | 'path' | 'occupancygrid' | 'cameraimage';

export const TOPIC_VISUALIZATION_TYPES: readonly TopicVisualizationType[] = ['pointcloud', 'camerainfo', 'urdf', 'laserscan', 'posestamped', 'markerarray', 'path', 'occupancygrid', 'cameraimage'];

/** ROS 1 and ROS 2 spellings of the message types each visualization can render. */
const MESSAGE_TYPES_BY_VISUALIZATION: Record<Exclude<TopicVisualizationType, 'urdf'>, readonly string[]> = {
  markerarray: ['visualization_msgs/MarkerArray', 'visualization_msgs/msg/MarkerArray'],
  pointcloud: ['sensor_msgs/PointCloud2', 'sensor_msgs/msg/PointCloud2'],
  camerainfo: ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'],
  laserscan: ['sensor_msgs/LaserScan', 'sensor_msgs/msg/LaserScan'],
  posestamped: ['geometry_msgs/PoseStamped', 'geometry_msgs/msg/PoseStamped'],
  path: ['nav_msgs/Path', 'nav_msgs/msg/Path'],
  occupancygrid: ['nav_msgs/OccupancyGrid', 'nav_msgs/msg/OccupancyGrid'],
  cameraimage: [...RAW_IMAGE_TYPES, ...COMPRESSED_IMAGE_TYPES],
};

export const isTopicVisualizationType = (value: unknown): value is TopicVisualizationType =>
  typeof value === 'string' && (TOPIC_VISUALIZATION_TYPES as readonly string[]).includes(value);

/** The topics a visualization of `type` can be pointed at. URDF is a String topic named
 * `robot_description`, so it is matched by name rather than by message type. */
export const getTopicsForVisualizationType = (type: TopicVisualizationType, topics: RosTopicInfo[]): RosTopicInfo[] => {
  if (type === 'urdf') return getUrdfTopics(topics);
  const supported = MESSAGE_TYPES_BY_VISUALIZATION[type];
  const compatible = topics.filter(topic => supported.includes(topic.type));
  if (type !== 'cameraimage') return compatible;
  // Prefer encoded color/mono streams for live 3D bandwidth; compressedDepth is not an image plane.
  const priority = (topic: RosTopicInfo) => /\/compressedDepth$/.test(topic.name) ? 2 : COMPRESSED_IMAGE_TYPES.includes(topic.type) ? 0 : 1;
  return compatible.sort((a, b) => priority(a) - priority(b));
};
