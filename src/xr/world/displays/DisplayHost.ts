import type * as THREE from 'three';
import type { Ros } from 'roslib';
import { subscribeToTfStream } from '../../../utils/tfStream';
import {
  CustomTFProvider,
  getTfFrameNames,
  normalizeFrameId,
  resolveFixedFrame,
  type TransformStore,
} from '../../../utils/tfUtils';
import {
  pickTfDisplaySettings,
  type VisualizationPanelState,
} from '../../../utils/visualizationState';
import { CameraInfoDisplay } from './CameraInfoDisplay';
import { LaserScanDisplay } from './LaserScanDisplay';
import { MarkerArrayDisplay } from './MarkerArrayDisplay';
import { PointCloudDisplay } from './PointCloudDisplay';
import { PoseStampedDisplay } from './PoseStampedDisplay';
import { TfDisplay } from './TfDisplay';
import { UrdfDisplay } from './UrdfDisplay';
import type { XrDisplay, XrDisplayEnv, XrLayer } from './types';

type LayerFactory = (env: XrDisplayEnv, layer: XrLayer) => XrDisplay;

const LAYER_FACTORIES: Partial<Record<string, LayerFactory>> = {
  urdf: (env, layer) => new UrdfDisplay(env, layer),
  pointcloud: (env, layer) => new PointCloudDisplay(env, layer),
  laserscan: (env, layer) => new LaserScanDisplay(env, layer),
  markerarray: (env, layer) => new MarkerArrayDisplay(env, layer),
  posestamped: (env, layer) => new PoseStampedDisplay(env, layer),
  camerainfo: (env, layer) => new CameraInfoDisplay(env, layer),
};

/** Point-based displays resolve each message against the fixed frame at creation time. */
const FIXED_FRAME_BOUND = new Set(['pointcloud', 'laserscan']);

export interface DisplayHostOptions {
  ros: Ros;
  /** Z-up ROS frame group of the panel world. */
  root: THREE.Group;
  meshResourcesBaseUrl: string;
  /** Called when the resolved fixed frame or the set of known frames changes. */
  onTfChanged?: () => void;
}

interface LiveLayer {
  signature: string;
  display: XrDisplay;
}

/**
 * The 3D panel's world model: one TF provider fed from the shared stream, plus the displays the
 * panel's saved state asks for.
 *
 * `setState` is declarative — it takes the same `VisualizationPanelState` the 2D panel persists and
 * reconciles to it, rebuilding only the displays whose own configuration changed. That keeps the
 * settings menu a pure editor of saved state and makes it impossible for the live scene and the
 * saved state to drift apart.
 */
export class DisplayHost {
  readonly provider = new CustomTFProvider('', {});
  private readonly env: XrDisplayEnv;
  private readonly layers = new Map<string, LiveLayer>();
  private readonly tf: TfDisplay;
  private readonly unsubscribeTf: () => void;
  private transforms: TransformStore = {};
  private state: VisualizationPanelState | null = null;
  private disposed = false;

  constructor(private readonly options: DisplayHostOptions) {
    this.env = {
      ros: options.ros,
      provider: this.provider,
      root: options.root,
      fixedFrame: this.provider.fixedFrame,
      meshResourcesBaseUrl: options.meshResourcesBaseUrl,
    };
    this.tf = new TfDisplay(this.env);
    this.unsubscribeTf = subscribeToTfStream(options.ros, update => {
      if (this.disposed) return;
      const knownBefore = Object.keys(this.transforms).length;
      this.transforms = update.transforms;
      this.provider.updateTransforms(update.transforms, update.changedFrames);
      const structural = Object.keys(update.transforms).length !== knownBefore;
      if (this.state && (this.adoptFixedFrame() || structural)) this.reconcile(this.state);
      else this.tf.setTransforms(update.transforms);
      if (structural) this.options.onTfChanged?.();
    });
  }

  get fixedFrame(): string {
    return this.provider.fixedFrame;
  }

  get frameNames(): string[] {
    return getTfFrameNames(this.transforms);
  }

  setState(state: VisualizationPanelState): void {
    if (this.disposed) return;
    this.state = state;
    this.adoptFixedFrame();
    this.reconcile(state);
  }

  update(nowMs: number): void {
    if (!this.disposed) this.tf.update(nowMs);
  }

  /** Resolve the panel's preferred frame against the live tree; true when the answer changed. */
  private adoptFixedFrame(): boolean {
    if (!this.state) return false;
    const resolved = normalizeFrameId(resolveFixedFrame(this.state.fixedFrame, this.transforms));
    if (resolved === this.provider.fixedFrame) return false;
    this.provider.updateFixedFrame(resolved);
    this.env.fixedFrame = resolved;
    this.options.onTfChanged?.();
    return true;
  }

  private reconcile(state: VisualizationPanelState): void {
    const wanted = new Map<string, { layer: XrLayer; signature: string }>();
    for (const layer of state.visualizations) {
      if (!LAYER_FACTORIES[layer.type] || !layer.topic) continue;
      const bound = FIXED_FRAME_BOUND.has(layer.type) ? this.env.fixedFrame : '';
      wanted.set(layer.id, {
        layer,
        signature: JSON.stringify([layer.type, layer.topic, layer.options ?? null, bound]),
      });
    }

    for (const [id, live] of this.layers) {
      if (wanted.get(id)?.signature === live.signature) continue;
      live.display.dispose();
      this.layers.delete(id);
    }
    for (const [id, { layer, signature }] of wanted) {
      if (this.layers.has(id)) continue;
      try {
        this.layers.set(id, { signature, display: LAYER_FACTORIES[layer.type]!(this.env, layer) });
      } catch (error) {
        console.error(`[XR] Failed to create ${layer.type} display for ${layer.topic}:`, error);
      }
    }

    const frames = state.showAllTfFrames ? getTfFrameNames(this.transforms) : state.displayedTfFrames;
    this.tf.configure(
      { ...pickTfDisplaySettings(state), frames },
      this.transforms
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeTf();
    for (const { display } of this.layers.values()) display.dispose();
    this.layers.clear();
    this.tf.dispose();
    this.provider.dispose();
  }
}
