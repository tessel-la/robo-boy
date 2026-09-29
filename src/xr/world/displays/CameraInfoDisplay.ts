import * as THREE from 'three';
import * as ROSLIB from 'roslib';
import type { CameraInfoOptions } from '../../../components/VisualizationPanel';
import { normalizeFrameId } from '../../../utils/tfUtils';
import { disposeObject, type XrDisplay, type XrDisplayEnv, type XrLayer } from './types';

const DEFAULT_LINE_COLOR = 0x00ff00;
const DEFAULT_LINE_SCALE = 1;
const FRUSTUM_INDICES = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];

interface CameraInfoMessage {
  header?: { frame_id?: string };
  k?: ArrayLike<number>;
  width?: number;
  height?: number;
}

/**
 * CameraInfo frustum, ported from `useCameraInfoVisualizer`: a pyramid derived from the intrinsics,
 * parked on the camera frame's TF and hidden until that frame resolves.
 */
export class CameraInfoDisplay implements XrDisplay {
  private readonly container = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly topic: ROSLIB.Topic;
  private readonly lineScale: number;
  private frameId: string | null = null;
  private disposed = false;

  constructor(private readonly env: XrDisplayEnv, layer: XrLayer) {
    const options = (layer.options ?? {}) as CameraInfoOptions;
    this.lineScale = options.lineScale ?? DEFAULT_LINE_SCALE;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
    geometry.setIndex(FRUSTUM_INDICES);
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: options.lineColor ?? DEFAULT_LINE_COLOR })
    );
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    this.container.visible = false;
    this.container.add(this.lines);
    env.root.add(this.container);

    this.topic = new ROSLIB.Topic({
      ros: env.ros,
      name: layer.topic,
      messageType: 'sensor_msgs/msg/CameraInfo',
      throttle_rate: 100,
    });
    this.topic.subscribe(this.receive as never);
  }

  private readonly receive = (message: CameraInfoMessage): void => {
    if (this.disposed) return;
    const frame = message.header?.frame_id;
    if (frame) this.followFrame(normalizeFrameId(frame));
    this.updateFrustum(message);
  };

  private followFrame(frame: string): void {
    if (frame === this.frameId) return;
    if (this.frameId) this.env.provider.unsubscribe(this.frameId, this.applyTransform);
    this.frameId = frame;
    this.env.provider.subscribe(frame, this.applyTransform);
  }

  private readonly applyTransform = (transform: any | null): void => {
    if (this.disposed) return;
    if (!transform) {
      this.container.visible = false;
      return;
    }
    const { translation, rotation } = transform;
    this.container.position.set(translation.x, translation.y, translation.z);
    this.container.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.container.visible = true;
  };

  private updateFrustum(message: CameraInfoMessage): void {
    const { k, width, height } = message;
    if (!k || k.length < 6 || !width || !height) {
      this.lines.visible = false;
      return;
    }
    const fx = k[0];
    const fy = k[4];
    const cx = k[2];
    const cy = k[5];
    const z = this.lineScale;
    const corner = (x: number, y: number): [number, number, number] => [((x - cx) * z) / fx, ((y - cy) * z) / fy, z];
    const points = [[0, 0, 0], corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)];

    const position = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    points.forEach((point, index) => position.array.set(point, index * 3));
    position.needsUpdate = true;
    this.lines.visible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.topic.unsubscribe();
    if (this.frameId) this.env.provider.unsubscribe(this.frameId, this.applyTransform);
    this.env.root.remove(this.container);
    disposeObject(this.container);
  }
}
