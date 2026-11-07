import * as THREE from 'three';
import ROSLIB, { type Ros, type Topic } from 'roslib';
import { rosStamp } from '../../rosTime';
import { CustomTFProvider } from '../../tfUtils';
import { decodeGrid, applyGridUpdate, gridPixels, type GridData } from '../../occupancyGridData';
import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../navigationOptions';
import { isReplayRos, isReplaySeeking, registerReplayGrid } from '../../../features/recordReplay/ReplaySession';

export class OccupancyGridClient {
  readonly object = new THREE.Group();
  private topic: Topic;
  private updates?: Topic;
  private updatesName = '';
  private releaseReplay?: () => void;
  private replayIncremental = false;
  private replayReady = false;
  private grid?: GridData;
  private resyncStamp = 0n;
  private stopTransform?: () => void;
  private transformKey = '';
  private mesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private configurationError: string | null = null;
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
    this.options = normalizeNavigationOptions(config.options, true);
    this.topic = new ROSLIB.Topic({
      ros: config.ros,
      name: config.topic,
      messageType: 'nav_msgs/OccupancyGrid',
      compression: 'cbor',
      throttle_rate: 0,
      queue_length: 0,
    });
    config.onStatus?.(
      'Waiting for map messages. Check map publisher durability/bridge QoS if a latched map is missing.'
    );
    this.configureUpdates();
    this.topic.subscribe(this.receive);
    config.ros.on?.('close', this.disconnected);
  }

  updateOptions(options: NavigationDisplayOptions = {}) {
    const previous = this.options;
    this.options = normalizeNavigationOptions(options, true);
    if (this.options.updatesTopic !== previous.updatesTopic) {
      this.resyncStamp = 0n;
      this.reset();
      this.configureUpdates();
      this.requestFullMap();
    }
    if (this.mesh) {
      this.mesh.material.opacity = this.options.opacity;
      if (this.grid && previous.palette !== this.options.palette) {
        const texture = this.mesh.material.map!;
        gridPixels(this.grid.cells, this.options.palette, texture.image.data as Uint8Array<ArrayBuffer>);
        texture.needsUpdate = true;
      }
    }
    this.object.visible = this.valid && this.options.visible;
    this.config.requestRender();
  }

  private configureUpdates() {
    this.updates?.unsubscribe();
    this.updates = undefined;
    this.releaseReplay?.();
    this.releaseReplay = undefined;
    this.replayIncremental = false;
    this.replayReady = false;
    this.configurationError = null;
    this.updatesName = this.options.updatesTopic;
    if (!this.updatesName) return;
    if (this.updatesName === this.config.topic || !/^\/[a-zA-Z0-9_/]+$/.test(this.updatesName)) {
      this.configurationError = 'Choose a distinct valid map updates topic.';
      this.config.onStatus?.(this.configurationError);
      return;
    }
    try {
      this.replayIncremental = isReplayRos(this.config.ros);
      this.releaseReplay = registerReplayGrid(this.config.ros, this.config.topic, this.updatesName, message => {
        this.replayReady = true;
        this.receiveFull(message);
      });
      this.updates = new ROSLIB.Topic({
        ros: this.config.ros,
        name: this.updatesName,
        messageType: 'map_msgs/OccupancyGridUpdate',
        compression: 'cbor',
        throttle_rate: 0,
        queue_length: 0,
      });
      this.updates.subscribe(this.receiveUpdate);
    } catch (error) {
      this.configurationError = error instanceof Error ? error.message : 'Could not subscribe to map updates.';
      this.config.onStatus?.(this.configurationError);
    }
  }

  private reset() {
    this.stopTransform?.();
    this.stopTransform = undefined;
    this.transformKey = '';
    this.grid = undefined;
    this.valid = false;
    this.object.visible = false;
    this.clearMesh();
    this.config.requestRender();
  }
  private disconnected = () => {
    if (this.disposed) return;
    this.resyncStamp = this.grid?.header.stamp ? this.grid.header.stamp + 1n : 0n;
    this.reset();
    this.config.onStatus?.('Connection lost. Waiting for a fresh full map before applying updates.');
  };
  private requestFullMap() {
    if (this.replayIncremental) return;
    this.topic.unsubscribe();
    this.topic.subscribe(this.receive);
  }
  private clearMesh() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
    this.mesh = undefined;
  }
  private watchTransform() {
    if (!this.grid) return;
    const { frameId, stamp } = this.grid.header,
      key = `${frameId}:${stamp}`;
    if (key === this.transformKey) return;
    this.stopTransform?.();
    this.transformKey = key;
    this.stopTransform = this.config.tfClient.watchTransform(frameId, stamp, result => {
      if (this.disposed || !this.grid) return;
      const wasVisible = this.object.visible;
      const moved =
        !!result.transform &&
        (!this.object.position.equals(result.transform.translation) ||
          !this.object.quaternion.equals(result.transform.rotation));
      this.valid = !!result.transform && !this.configurationError;
      this.object.visible = this.valid && this.options.visible;
      if (result.transform) {
        this.object.position.copy(result.transform.translation);
        this.object.quaternion.copy(result.transform.rotation);
      }
      this.config.onStatus?.(this.configurationError ?? result.error);
      if (moved || wasVisible !== this.object.visible) this.config.requestRender();
    });
  }
  private receive = (message: unknown) => {
    if (this.replayIncremental && (!this.replayReady || isReplaySeeking(this.config.ros))) return;
    this.receiveFull(message);
  };
  private receiveFull = (message: unknown) => {
    if (this.disposed) return;
    try {
      const grid = decodeGrid(message, this.config.maxTextureSize);
      if (!grid) {
        this.reset();
        this.config.onStatus?.(null);
        return;
      }
      if (this.resyncStamp && (!grid.header.stamp || grid.header.stamp < this.resyncStamp)) {
        this.config.onStatus?.(
          grid.header.stamp
            ? 'Waiting for a fresh full map; the retained snapshot predates the invalid update chain.'
            : 'Timestamped full map required for recovery. Reselect Updates topic to reset an unstamped stream.'
        );
        return;
      }
      this.resyncStamp = 0n;
      const previous = this.grid;
      if (
        !previous ||
        previous.width !== grid.width ||
        previous.height !== grid.height ||
        previous.resolution !== grid.resolution
      )
        this.clearMesh();
      this.grid = grid;
      const pixels = gridPixels(
        grid.cells,
        this.options.palette,
        this.mesh?.material.map?.image.data as Uint8Array<ArrayBuffer> | undefined
      );
      if (!this.mesh) {
        const texture = new THREE.DataTexture(pixels, grid.width, grid.height, THREE.RGBAFormat);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.flipY = false;
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
        const width = grid.width * grid.resolution,
          height = grid.height * grid.resolution;
        const geometry = new THREE.PlaneGeometry(width, height);
        geometry.translate(width / 2, height / 2, 0);
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.renderOrder = -1;
        this.object.add(this.mesh);
      }
      this.mesh.material.map!.needsUpdate = true;
      this.mesh.position.fromArray(grid.position);
      this.mesh.quaternion.fromArray(grid.rotation);
      this.watchTransform();
    } catch (error) {
      this.reset();
      this.config.onStatus?.(error instanceof Error ? error.message : 'Invalid OccupancyGrid message.');
    } finally {
      this.config.requestRender();
    }
  };
  private receiveUpdate = (message: any) => {
    if (this.replayIncremental && (!this.replayReady || isReplaySeeking(this.config.ros))) return;
    if (this.disposed || !this.grid || !this.mesh) return;
    try {
      if (!applyGridUpdate(this.grid, message)) return;
      const texture = this.mesh.material.map!;
      gridPixels(this.grid.cells, this.options.palette, texture.image.data as Uint8Array<ArrayBuffer>, {
        ...message,
        stride: this.grid.width,
      });
      texture.needsUpdate = true;
      this.watchTransform();
      this.config.requestRender();
    } catch (error) {
      const stamp = rosStamp(message?.header?.stamp) ?? 0n;
      this.resyncStamp = (this.grid.header.stamp > stamp ? this.grid.header.stamp : stamp) + 1n;
      this.reset();
      this.config.onStatus?.(
        `${error instanceof Error ? error.message : 'Invalid map update.'} Waiting for a fresh full map.`
      );
      this.requestFullMap();
    }
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.config.ros.off?.('close', this.disconnected);
    this.topic.unsubscribe();
    this.updates?.unsubscribe();
    this.releaseReplay?.();
    this.reset();
    this.object.removeFromParent();
    this.config.requestRender();
  }
}
