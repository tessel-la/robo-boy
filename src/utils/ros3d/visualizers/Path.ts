import * as THREE from 'three';
import ROSLIB, { type Ros, type Topic } from 'roslib';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CustomTFProvider } from '../../tfUtils';
import { decodePath } from '../../navigationMessages';
import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../navigationOptions';

export class PathClient {
  readonly object = new Line2(new LineGeometry(), new LineMaterial({ worldUnits: true }));
  private topic: Topic;
  private stopTransform?: () => void;
  private disposed = false;
  private valid = false;
  private options = normalizeNavigationOptions();

  constructor(
    private config: {
      ros: Ros;
      topic: string;
      tfClient: CustomTFProvider;
      rootObject: THREE.Object3D;
      requestRender: () => void;
      onStatus?: (status: string | null) => void;
      options?: NavigationDisplayOptions;
    }
  ) {
    this.object.name = `Path: ${config.topic}`;
    this.object.visible = false;
    this.object.frustumCulled = false; // Wide-line bounds do not include the world-space width.
    this.object.onBeforeRender = renderer => {
      renderer.getDrawingBufferSize(this.object.material.resolution);
    };
    config.rootObject.add(this.object);
    this.updateOptions(config.options);
    this.topic = new ROSLIB.Topic({
      ros: config.ros,
      name: config.topic,
      messageType: 'nav_msgs/Path',
      compression: 'cbor',
      queue_length: 1,
    });
    config.onStatus?.('Waiting for path messages.');
    this.topic.subscribe(this.receive);
  }

  updateOptions(options: NavigationDisplayOptions = {}) {
    this.options = normalizeNavigationOptions(options);
    this.object.material.color.set(this.options.color);
    this.object.material.linewidth = this.options.lineWidth;
    this.object.material.opacity = this.options.opacity;
    this.object.material.transparent = this.options.opacity < 1;
    this.object.material.depthWrite = this.options.opacity === 1;
    this.object.material.needsUpdate = true;
    this.object.visible = this.valid && this.options.visible;
    this.config.requestRender();
  }

  private receive = (message: unknown) => {
    if (this.disposed) return;
    this.stopTransform?.();
    this.stopTransform = undefined;
    this.valid = false;
    this.object.visible = false;
    // Drop obsolete geometry even when the replacement is malformed or waiting for TF.
    this.object.geometry.dispose();
    this.object.geometry = new LineGeometry();
    try {
      const path = decodePath(message);
      if (path.points.length === 0) {
        this.config.onStatus?.(null);
        return;
      }
      if (path.points.length === 3) {
        this.config.onStatus?.('Path needs at least two poses to draw a line.');
        return;
      }
      let previous: Float32Array | undefined;
      const point = new THREE.Vector3();
      this.stopTransform = this.config.tfClient.watchTransforms(path.requests, results => {
        if (this.disposed) return;
        const wasVisible = this.object.visible;
        let geometryChanged = false;
        const failure = results.find(result => !result.transform);
        this.valid = !failure;
        this.object.visible = this.valid && this.options.visible;
        if (failure) {
          this.config.onStatus?.(failure.error);
          if (wasVisible) this.config.requestRender();
          return;
        }
        const positions = new Float32Array(path.points.length);
        for (let i = 0; i < path.transforms.length; i++) {
          const transform = results[path.transforms[i]].transform!;
          point
            .fromArray(path.points, i * 3)
            .applyQuaternion(transform.rotation)
            .add(transform.translation);
          positions.set([point.x, point.y, point.z], i * 3);
        }
        if (!positions.every(Number.isFinite)) {
          this.valid = false;
          this.object.visible = false;
          this.config.onStatus?.('Transformed path coordinates exceed rendering limits.');
        } else {
          if (!previous || positions.some((value, i) => value !== previous![i])) {
            const geometry = new LineGeometry();
            geometry.setPositions(positions);
            this.object.geometry.dispose();
            this.object.geometry = geometry;
            previous = positions;
            geometryChanged = true;
          }
          this.config.onStatus?.(null);
        }
        if (geometryChanged || wasVisible !== this.object.visible) this.config.requestRender();
      });
    } catch (error) {
      this.config.onStatus?.(error instanceof Error ? error.message : 'Invalid Path message.');
    } finally {
      this.config.requestRender();
    }
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.topic.unsubscribe();
    this.stopTransform?.();
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.config.requestRender();
  }
}
