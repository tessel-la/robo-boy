import * as THREE from 'three';
import ROSLIB, { type Ros, type Topic } from 'roslib';
import { CustomTFProvider } from '../../tfUtils';
import { decodeOccupancyGrid } from '../../navigationMessages';
import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../navigationOptions';

export class OccupancyGridClient {
  readonly object = new THREE.Group();
  private topic: Topic;
  private stopTransform?: () => void;
  private mesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private disposed = false;
  private valid = false;
  private options = normalizeNavigationOptions({}, true);

  constructor(
    private config: {
      ros: Ros;
      topic: string;
      tfClient: CustomTFProvider;
      rootObject: THREE.Object3D;
      requestRender: () => void;
      onStatus?: (status: string | null) => void;
      options?: NavigationDisplayOptions;
      maxTextureSize?: number;
    }
  ) {
    this.object.name = `Occupancy grid: ${config.topic}`;
    this.object.visible = false;
    config.rootObject.add(this.object);
    this.updateOptions(config.options);
    this.topic = new ROSLIB.Topic({
      ros: config.ros,
      name: config.topic,
      messageType: 'nav_msgs/OccupancyGrid',
      compression: 'cbor',
      queue_length: 1,
    });
    config.onStatus?.(
      'Waiting for map messages. Check map publisher durability/bridge QoS if a latched map is missing.'
    );
    this.topic.subscribe(this.receive);
  }

  updateOptions(options: NavigationDisplayOptions = {}) {
    this.options = normalizeNavigationOptions(options, true);
    if (this.mesh) this.mesh.material.opacity = this.options.opacity;
    this.object.visible = this.valid && this.options.visible;
    this.config.requestRender();
  }

  private clearMesh() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
    this.mesh = undefined;
  }

  private receive = (message: unknown) => {
    if (this.disposed) return;
    this.stopTransform?.();
    this.stopTransform = undefined;
    this.valid = false;
    this.object.visible = false;
    this.clearMesh();
    try {
      const grid = decodeOccupancyGrid(message, this.config.maxTextureSize);
      if (!grid) {
        this.config.onStatus?.(null);
        return;
      }
      const texture = new THREE.DataTexture(grid.pixels, grid.width, grid.height, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = false; // Row zero is the bottom row in the map's local XY plane.
      texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        opacity: this.options.opacity,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const w = grid.width * grid.resolution,
        h = grid.height * grid.resolution;
      // PlaneGeometry is centered; OccupancyGrid origin is the lower-left corner of cell (0,0).
      const geometry = new THREE.PlaneGeometry(w, h);
      geometry.translate(w / 2, h / 2, 0);
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.position.copy(grid.position);
      this.mesh.quaternion.copy(grid.rotation);
      this.mesh.renderOrder = -1;
      this.object.add(this.mesh);
      this.stopTransform = this.config.tfClient.watchTransform(grid.header.frameId, grid.header.stamp, result => {
        if (this.disposed) return;
        const wasVisible = this.object.visible;
        const moved =
          !!result.transform &&
          (!this.object.position.equals(result.transform.translation) ||
            !this.object.quaternion.equals(result.transform.rotation));
        this.valid = !!result.transform;
        this.object.visible = this.valid && this.options.visible;
        if (result.transform) {
          this.object.position.copy(result.transform.translation);
          this.object.quaternion.copy(result.transform.rotation);
        }
        this.config.onStatus?.(result.error);
        if (moved || wasVisible !== this.object.visible) this.config.requestRender();
      });
    } catch (error) {
      this.config.onStatus?.(error instanceof Error ? error.message : 'Invalid OccupancyGrid message.');
    } finally {
      this.config.requestRender();
    }
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.topic.unsubscribe();
    this.stopTransform?.();
    this.clearMesh();
    this.object.removeFromParent();
    this.config.requestRender();
  }
}
