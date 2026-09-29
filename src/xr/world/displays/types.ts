import type * as THREE from 'three';
import type { Ros } from 'roslib';
import type { CustomTFProvider, TransformStore } from '../../../utils/tfUtils';
import type { VisualizationPanelState } from '../../../utils/visualizationState';

export type XrLayer = VisualizationPanelState['visualizations'][number];

/** What every display needs from the panel world that hosts it. */
export interface XrDisplayEnv {
  ros: Ros;
  /** The panel's own TF provider; fed from the shared `/tf` stream, never a new subscription. */
  provider: CustomTFProvider;
  /** Z-up ROS frame group. Everything a display creates is parented here. */
  root: THREE.Group;
  /** Frame the provider currently resolves against, already normalised. */
  fixedFrame: string;
  meshResourcesBaseUrl: string;
}

/**
 * One live ROS visualization inside a panel world.
 *
 * Displays are framework-agnostic ports of the 2D panel's hooks: they own their ROS subscription and
 * scene objects, are rebuilt by `DisplayHost` whenever their configuration changes, and release
 * everything in `dispose`. `update` is for displays that poll (only the TF frames do, throttled).
 */
export interface XrDisplay {
  update?(nowMs: number): void;
  dispose(): void;
}

export const disposeObject = (object: THREE.Object3D): void => {
  object.traverse(child => {
    const renderable = child as THREE.Mesh;
    renderable.geometry?.dispose?.();
    const material = renderable.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose());
    else material?.dispose?.();
  });
};

export type { TransformStore };
