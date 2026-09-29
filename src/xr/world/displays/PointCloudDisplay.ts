import * as THREE from 'three';
import * as ROS3D from '../../../utils/ros3d';
import type { PointCloudOptions } from '../../../components/VisualizationPanel';
import { isMobile } from '../../../utils/platformUtils';
import { createPointCloudShaderMaterial } from '../../../utils/pointCloudShaders';
import { cleanupPointCloudClient } from '../../../utils/pointCloudCleanup';
import type { XrDisplay, XrDisplayEnv, XrLayer } from './types';

const MAX_RANGE_RETRIES = 10;

/**
 * PointCloud2, ported from `usePointCloudClient`. The construction options, the cbor/throttle/queue
 * settings, the shader-material path for axis colouring and the auto-ranging of that axis are the
 * 2D behaviour verbatim; only the scene (a panel's ROS frame instead of a viewer) differs.
 */
export class PointCloudDisplay implements XrDisplay {
  private client: ROS3D.PointCloud2 | null = null;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();

  constructor(private readonly env: XrDisplayEnv, layer: XrLayer) {
    const options = (layer.options ?? {}) as Partial<PointCloudOptions>;
    const { fixedFrame } = env;
    const colorAxis = options.colorAxis && options.colorAxis !== 'none' ? options.colorAxis : undefined;
    const mobile = isMobile();

    const clientOptions: Record<string, unknown> = {
      ros: env.ros,
      tfClient: env.provider,
      rootObject: env.root,
      topic: layer.topic,
      max_pts: options.maxPoints ?? (mobile ? 100000 : 200000),
      throttle_rate: 33,
      compression: 'cbor',
      queue_length: 1,
      fixedFrame,
      requestRender: () => undefined,
      messageHandler: function (this: any, message: any) {
        try {
          this.fixedFrame = fixedFrame;
          if (!this.tfClient || typeof this.tfClient.lookupTransform !== 'function') return;
          if (message.header?.frame_id) this.processMessage(message);
        } catch (error) {
          console.error('[XR PointCloud2] Error handling message:', error);
        }
      },
    };

    if (colorAxis) {
      clientOptions.material = createPointCloudShaderMaterial({
        colorMode: colorAxis,
        minColor: options.minColor ? new THREE.Color(options.minColor) : undefined,
        maxColor: options.maxColor ? new THREE.Color(options.maxColor) : undefined,
        minAxisValue: options.minAxisValue,
        maxAxisValue: options.maxAxisValue,
        pointSize: options.pointSize,
      });
      clientOptions.customShader = true;
      if (mobile) clientOptions.max_pts = Math.min(options.maxPoints ?? 100000, 50000);
    } else {
      clientOptions.material = {
        size: options.pointSize ?? 0.05,
        color: new THREE.Color(options.color ?? 0x00ff00),
      };
    }

    try {
      this.client = new ROS3D.PointCloud2(clientOptions as never);
    } catch (error) {
      console.error('[XR PointCloud2] Failed to create client:', error);
      return;
    }

    this.every(100, stop => {
      const object = this.pointsObject();
      if (!object) return;
      object.frustumCulled = false;
      stop();
    });
    if (colorAxis) this.autoRange(colorAxis);
  }

  private pointsObject(): THREE.Points | null {
    return ((this.client as any)?.points?.object as THREE.Points | undefined) ?? null;
  }

  private every(ms: number, tick: (stop: () => void) => void): void {
    const id = setInterval(() => tick(() => {
      clearInterval(id);
      this.timers.delete(id);
    }), ms);
    this.timers.add(id);
  }

  /** Fit the colour ramp to the data on the coloured axis, as the 2D panel does. */
  private autoRange(axis: 'x' | 'y' | 'z'): void {
    const initial = this.pointsObject();
    const initialMaterial = initial?.material as THREE.ShaderMaterial | undefined;
    if (initialMaterial) initialMaterial.opacity = 0.3;

    const read = { x: 'getX', y: 'getY', z: 'getZ' }[axis] as 'getX' | 'getY' | 'getZ';
    let retries = 0;
    this.every(200, stop => {
      const object = this.pointsObject();
      const material = object?.material as THREE.ShaderMaterial | undefined;
      const positions = object?.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (object && material?.uniforms && positions && positions.count > 0) {
        let min = Infinity;
        let max = -Infinity;
        const step = Math.max(1, Math.floor(positions.count / Math.min(positions.count, 1000)));
        for (let index = 0; index < positions.count; index += step) {
          const value = positions[read](index);
          if (Number.isFinite(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          const pad = (max - min) * 0.05;
          material.uniforms.minAxisValue = { value: min - pad };
          material.uniforms.maxAxisValue = { value: max + pad };
          material.opacity = 1;
          stop();
          return;
        }
      }
      retries += 1;
      if (retries >= MAX_RANGE_RETRIES) {
        if (material?.uniforms) {
          material.uniforms.minAxisValue = { value: -10 };
          material.uniforms.maxAxisValue = { value: 10 };
          material.opacity = 1;
        }
        stop();
      }
    });
  }

  dispose(): void {
    this.timers.forEach(clearInterval);
    this.timers.clear();
    // The cleanup helper only detaches an object that is a direct child of the scene it is given,
    // so hand it the panel's ROS frame in that role.
    cleanupPointCloudClient(this.client, this.env.root as unknown as THREE.Scene);
    this.client = null;
  }
}
