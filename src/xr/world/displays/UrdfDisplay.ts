import * as ROS3D from '../../../utils/ros3d';
import type { UrdfOptions } from '../../../components/VisualizationPanel';
import type { XrDisplay, XrDisplayEnv, XrLayer } from './types';

/**
 * The robot model. `ROS3D.UrdfClient` is renderer-agnostic — it parses the URDF, resolves
 * package:// meshes and moves links from the provider's TF — and releases its own resources, so it
 * attaches to the panel's ROS frame unchanged.
 */
export class UrdfDisplay implements XrDisplay {
  private client: ROS3D.UrdfClient | null;

  constructor(env: XrDisplayEnv, layer: XrLayer) {
    const options = (layer.options ?? {}) as UrdfOptions;
    this.client = new ROS3D.UrdfClient({
      ros: env.ros,
      tfClient: env.provider,
      rootObject: env.root,
      robotDescriptionTopic: options.robotDescriptionTopic ?? layer.topic ?? '/robot_description',
      path: env.meshResourcesBaseUrl,
    });
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
  }
}
