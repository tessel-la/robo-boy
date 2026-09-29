import * as THREE from 'three';
import * as ROS3D from '../../../utils/ros3d';
import type { LaserScanOptions } from '../../../components/visualizers/LaserScanViz';
import type { XrDisplay, XrDisplayEnv, XrLayer } from './types';

const DEFAULT_POINT_SIZE = 1.0;
const DEFAULT_POINT_COLOR = '#0000ff';

const parseColor = (value: string | THREE.Color | undefined): THREE.Color => {
  if (value instanceof THREE.Color) return value;
  try {
    return new THREE.Color(value ?? DEFAULT_POINT_COLOR);
  } catch {
    return new THREE.Color(DEFAULT_POINT_COLOR);
  }
};

export class LaserScanDisplay implements XrDisplay {
  private client: ROS3D.LaserScan | null;

  constructor(env: XrDisplayEnv, layer: XrLayer) {
    const options = (layer.options ?? {}) as LaserScanOptions;
    this.client = new ROS3D.LaserScan({
      ros: env.ros,
      topic: layer.topic,
      tfClient: env.provider,
      rootObject: env.root,
      fixedFrame: env.fixedFrame,
      material: {
        size: options.pointSize ?? DEFAULT_POINT_SIZE,
        color: parseColor(options.pointColor),
      },
      maxRange: options.maxRange,
      minRange: options.minRange,
      requestRender: () => undefined,
    });
  }

  dispose(): void {
    this.client?.unsubscribe();
    this.client = null;
  }
}
