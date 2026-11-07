import * as THREE from 'three';
import { Topic, type Ros } from 'roslib';
import type { CustomTFProvider } from '../../tfUtils';
import { decodePointCloud, type PointCloudMessage } from '../../pointCloudDecoder';
import { watchMessageTransform } from '../../stampedTransform';
import { isCompressedPointCloud } from '../../cloudini/cloudiniMessage';
import { subscribeCloudini } from '../../cloudini/cloudiniStreams';

type Settings = {
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  originX?: number;
  originY?: number;
  originZ?: number;
  pointSize?: number;
  color?: THREE.Color | number | string;
  minColor?: THREE.Color;
  maxColor?: THREE.Color;
  colorMode?: string;
  minAxisValue?: number;
  maxAxisValue?: number;
};
type Options = {
  ros: Ros;
  topic: string;
  messageType?: string;
  tfClient: CustomTFProvider;
  rootObject: THREE.Object3D;
  max_pts?: number;
  size?: number;
  material?: THREE.Material | Record<string, any>;
  colorsrc?: string;
  compression?: 'cbor' | 'png' | 'none';
  throttle_rate?: number;
  fixedFrame?: string;
  requestRender?: () => void;
  onStatus?: (status: string | null) => void;
} & Settings;

/** Latest cloud geometry, anchored at acquisition time. No continuous transform/render loop. */
export class PointCloud2 extends THREE.Object3D {
  public points!: { object: THREE.Points; geometry: THREE.BufferGeometry; material: THREE.Material; setup: boolean };
  public fixedFrame: string;
  private subscription: Topic | null = null;
  private stopCompressed?: () => void;
  private stopTransform?: () => void;
  private header?: PointCloudMessage['header'];
  private settings: Settings;
  private active = true;
  private readonly maxPoints: number;

  constructor(private options: Options) {
    super();
    this.maxPoints = Math.max(
      1,
      Math.min(1_000_000, Math.floor(Number.isFinite(options.max_pts) ? options.max_pts! : 100000))
    );
    this.fixedFrame = options.fixedFrame ?? options.tfClient.fixedFrame;
    this.settings = { ...options, pointSize: options.size ?? (options.material as { size?: number })?.size ?? 0.05 };
    this.initializePoints(options.material);
    this.visible = false;
    options.rootObject.add(this);
    options.onStatus?.('Waiting for point cloud messages.');
    if (isCompressedPointCloud(options.messageType ?? '')) {
      this.stopCompressed = subscribeCloudini(options.ros, options.topic, event => {
        if (!this.active) return;
        if (event.message) this.receive(event.message);
        else if (event.error) {
          this.stopTransform?.();
          this.stopTransform = undefined;
          this.visible = false;
          this.points.geometry.setDrawRange(0, 0);
          options.onStatus?.(event.error);
          this.render();
        }
      });
    } else {
      this.subscription = new Topic({
        ros: options.ros,
        name: options.topic,
        messageType: options.messageType ?? 'sensor_msgs/PointCloud2',
        compression: options.compression ?? 'none',
        throttle_rate: options.throttle_rate ?? 100,
        queue_length: 1,
      });
      this.subscription.subscribe(this.receive);
    }
  }

  private render = () => this.options.requestRender?.();

  private initializePoints(material?: Options['material']) {
    const previous = this.points;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.maxPoints * 3), 3));
    geometry.setDrawRange(0, 0);
    const selected =
      material instanceof THREE.Material
        ? material
        : new THREE.PointsMaterial({
            size: this.settings.pointSize,
            color: (material as any)?.color ?? 0x00ff00,
            sizeAttenuation: true,
          });
    const object = new THREE.Points(geometry, selected);
    object.frustumCulled = false;
    this.points = { object, geometry, material: selected, setup: true };
    this.add(object);
    if (previous) {
      this.remove(previous.object);
      previous.geometry.dispose();
      if (previous.material !== selected) previous.material.dispose();
    }
  }

  private receive = (message: PointCloudMessage) => {
    if (!this.active) return;
    this.stopTransform?.();
    this.stopTransform = undefined;
    this.visible = false;
    try {
      const positions = this.points.geometry.getAttribute('position');
      const output = positions.array as Float32Array;
      const count = decodePointCloud(message, output);
      const s = this.settings;
      for (let i = 0; i < count * 3; i += 3) {
        output[i] = output[i] * (s.scaleX ?? 1) + (s.originX ?? 0);
        output[i + 1] = output[i + 1] * (s.scaleY ?? 1) + (s.originY ?? 0);
        output[i + 2] = output[i + 2] * (s.scaleZ ?? 1) + (s.originZ ?? 0);
      }
      positions.needsUpdate = true;
      this.points.geometry.setDrawRange(0, count);
      this.header = message.header;
      if (count) this.forceTransformUpdate();
      else this.options.onStatus?.('Point cloud contains no finite points.');
    } catch (error) {
      this.points.geometry.setDrawRange(0, 0);
      this.options.onStatus?.(error instanceof Error ? error.message : 'Invalid point cloud.');
    }
    this.render();
  };

  public forceTransformUpdate() {
    this.stopTransform?.();
    if (!this.active || !this.points.geometry.drawRange.count) return;
    this.stopTransform = watchMessageTransform(this.options.tfClient, this.header, ({ transform, error }) => {
      if (!this.active) return;
      const changed =
        this.visible !== !!transform ||
        (transform && (!this.position.equals(transform.translation) || !this.quaternion.equals(transform.rotation)));
      this.visible = !!transform;
      if (transform) {
        this.position.copy(transform.translation);
        this.quaternion.copy(transform.rotation);
      }
      this.options.onStatus?.(error);
      if (changed) this.render();
    });
  }

  public safeResetPoints(material?: Options['material']): boolean {
    this.initializePoints(material ?? this.points?.material);
    this.stopTransform?.();
    this.stopTransform = undefined;
    this.visible = false;
    this.render();
    return true;
  }

  public updateSettings(settings: Settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.points.material instanceof THREE.PointsMaterial) {
      if (settings.pointSize !== undefined) this.points.material.size = settings.pointSize;
      if (settings.color !== undefined) this.points.material.color.set(settings.color);
    }
    this.render();
  }

  public unsubscribe() {
    this.active = false;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.stopCompressed?.();
    this.stopCompressed = undefined;
    this.stopTransform?.();
    this.stopTransform = undefined;
    this.visible = false;
  }
}
