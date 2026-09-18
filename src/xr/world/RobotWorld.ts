import * as THREE from 'three';
import type { Ros } from 'roslib';
import * as ROS3D from '../../utils/ros3d';
import { subscribeToTfStream } from '../../utils/tfStream';
import { CustomTFProvider } from '../../utils/tfUtils';
import { XR_WORLD_PLACEMENT_ID, type XrGrabbableData } from '../types';

export interface RobotWorldOptions {
  ros: Ros;
  /** Group the world is parented under, normally XrSceneManager.worldGroup. */
  parent: THREE.Object3D;
  /** Same endpoint the 2D panel uses, from useRuntimeConfig().meshResourcesBaseUrl. */
  meshResourcesBaseUrl: string;
  fixedFrame: string;
  robotDescriptionTopic?: string;
  onLoaded?: () => void;
}

/**
 * The robot, as real geometry in the user's space.
 *
 * This is where the reuse in this feature actually pays off. `ROS3D.UrdfClient` extends
 * THREE.Object3D, takes a `rootObject` to attach to and an optional `requestRender` that defaults to
 * a no-op, so the entire pipeline behind it — URDF parsing, package:// resolution, Collada/OBJ/STL
 * loading, and per-link pose driven from TF — runs unchanged against an XR scene. None of it is
 * duplicated, and a fix to robot rendering in the 2D panel lands here for free.
 *
 * `requestRender` is deliberately left unset: the XR session renders continuously through
 * `setAnimationLoop`, so the invalidation callback the 2D viewer needs has nothing to do here.
 *
 * TF comes from `subscribeToTfStream`, which is reference-counted per Ros connection through a
 * WeakMap. Opening the XR world alongside a 2D 3D panel therefore still results in exactly one
 * `/tf` and one `/tf_static` subscription, which docs/performance.md treats as a regression contract.
 */
export class RobotWorld {
  /** Grabbable root. Moving, turning or scaling this moves the whole robot and its frames. */
  readonly object = new THREE.Group();

  /**
   * ROS is Z-up; a WebXR reference space is Y-up. Rotating one group once is cheaper and far less
   * error-prone than converting every transform, and it keeps the ROS3D classes unmodified.
   */
  private readonly rosFrame = new THREE.Group();

  private readonly tfProvider: CustomTFProvider;
  private readonly unsubscribeTf: () => void;
  private urdfClient: ROS3D.UrdfClient | null = null;
  private disposed = false;

  constructor(options: RobotWorldOptions) {
    this.object.name = 'xr-robot-world';
    this.rosFrame.rotation.x = -Math.PI / 2;
    this.object.add(this.rosFrame);

    const grabbable: XrGrabbableData = {
      xrGrabbable: true,
      placementId: XR_WORLD_PLACEMENT_ID,
      allowScale: true,
    };
    this.object.userData = { ...this.object.userData, ...grabbable };

    this.tfProvider = new CustomTFProvider(options.fixedFrame, {});
    this.unsubscribeTf = subscribeToTfStream(options.ros, update => {
      if (this.disposed) return;
      this.tfProvider.updateTransforms(update.transforms, update.changedFrames);
    });

    this.urdfClient = new ROS3D.UrdfClient({
      ros: options.ros,
      tfClient: this.tfProvider,
      rootObject: this.rosFrame,
      robotDescriptionTopic: options.robotDescriptionTopic ?? '/robot_description',
      path: options.meshResourcesBaseUrl,
      onComplete: () => {
        if (this.disposed) return;
        options.onLoaded?.();
      },
    });

    options.parent.add(this.object);
  }

  /** Change the frame every link is resolved against, matching the 2D panel's fixed-frame control. */
  setFixedFrame(fixedFrame: string): void {
    if (this.disposed) return;
    this.tfProvider.updateFixedFrame(fixedFrame);
  }

  /** True once a URDF has been parsed and its meshes attached. */
  get hasModel(): boolean {
    return this.rosFrame.children.length > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.urdfClient?.dispose();
    this.urdfClient = null;
    this.unsubscribeTf();
    this.tfProvider.dispose();

    this.object.parent?.remove(this.object);
    this.object.traverse(child => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach(entry => entry.dispose());
      else material?.dispose();
    });
    this.object.clear();
  }
}
