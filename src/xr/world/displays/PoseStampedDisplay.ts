import * as THREE from 'three';
import * as ROSLIB from 'roslib';
import * as ROS3D from '../../../utils/ros3d';
import type { PoseStampedOptions } from '../../../hooks/usePoseStampedClient';
import { disposeObject, type XrDisplay, type XrDisplayEnv, type XrLayer } from './types';

interface PoseMessage {
  pose: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
}

const createArrow = (length: number, width: number, color: THREE.Color): THREE.Group => {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.3, width * 0.3, length * 0.8, 8), material);
  shaft.rotateZ(-Math.PI / 2);
  shaft.position.set(length * 0.4, 0, 0);
  group.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(width, length * 0.2, 8), material);
  head.rotateZ(-Math.PI / 2);
  head.position.set(length * 0.9, 0, 0);
  group.add(head);
  return group;
};

/**
 * PoseStamped, ported from `usePoseStampedClient`. The pose is applied directly in the fixed frame
 * (the message frame is not looked up), and the option flags that mean "use the default" are
 * honoured exactly as in 2D. Changed options rebuild the whole display, so there is no in-place
 * option update path to keep in sync.
 */
export class PoseStampedDisplay implements XrDisplay {
  private readonly group = new THREE.Group();
  private readonly topic: ROSLIB.Topic;
  private readonly trailPoints: THREE.Vector3[] = [];
  private trailLine: THREE.Line | null = null;
  private marker: THREE.Object3D | null = null;
  private disposed = false;

  private readonly kind: 'arrow' | 'axes';
  private readonly scale: number;
  private readonly color: THREE.Color;
  private readonly arrowLength: number;
  private readonly arrowWidth: number;
  private readonly axesSize: number;
  private readonly showTrail: boolean;
  private readonly maxTrailLength: number;

  constructor(private readonly env: XrDisplayEnv, layer: XrLayer) {
    const options = (layer.options ?? {}) as PoseStampedOptions;
    this.kind = options.visualizationType ?? 'arrow';
    this.scale = options.scaleEnabled !== false ? options.scale || 1 : 1;
    this.color = new THREE.Color(options.colorEnabled !== false ? options.color || '#00ff00' : '#00ff00');
    const dimensions = options.arrowDimensionsEnabled !== false;
    this.arrowLength = dimensions ? options.arrowLength || 1 : 1;
    this.arrowWidth = dimensions ? options.arrowWidth || 0.1 : 0.1;
    this.axesSize = dimensions ? options.axesSize || 0.5 : 0.5;
    this.showTrail = options.trailEnabled === true && options.showTrail !== false;
    this.maxTrailLength = options.trailEnabled === true ? options.maxTrailLength || 50 : 50;

    env.root.add(this.group);
    this.topic = new ROSLIB.Topic({
      ros: env.ros,
      name: layer.topic,
      messageType: 'geometry_msgs/msg/PoseStamped',
    });
    this.topic.subscribe(this.receive as never);
  }

  private readonly receive = (message: PoseMessage): void => {
    if (this.disposed) return;
    try {
      const { position, orientation } = message.pose;
      if (!this.marker) {
        this.marker =
          this.kind === 'arrow'
            ? createArrow(this.arrowLength * this.scale, this.arrowWidth * this.scale, this.color)
            : new ROS3D.Axes({ lineSize: this.axesSize * this.scale });
        this.group.add(this.marker);
      }
      this.marker.position.set(position.x, position.y, position.z);
      this.marker.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
      if (this.showTrail) this.extendTrail(this.marker.position);
    } catch (error) {
      console.error('[XR PoseStamped] Error processing message:', error);
    }
  };

  private extendTrail(position: THREE.Vector3): void {
    this.trailPoints.push(position.clone());
    if (this.trailPoints.length > this.maxTrailLength) this.trailPoints.shift();
    this.clearTrail();
    if (this.trailPoints.length < 2) return;
    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.trailPoints),
      new THREE.LineBasicMaterial({ color: this.color, opacity: 0.6, transparent: true })
    );
    this.group.add(this.trailLine);
  }

  private clearTrail(): void {
    if (!this.trailLine) return;
    this.group.remove(this.trailLine);
    this.trailLine.geometry.dispose();
    (this.trailLine.material as THREE.Material).dispose();
    this.trailLine = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.topic.unsubscribe();
    this.clearTrail();
    this.env.root.remove(this.group);
    disposeObject(this.group);
    this.group.clear();
    this.marker = null;
    this.trailPoints.length = 0;
  }
}
