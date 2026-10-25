import * as THREE from 'three';
import type { Ros } from 'roslib';
import type { CustomTFProvider } from '../../tfUtils';
import { rosStamp, type TransformResult } from '../../tfHistory';
import { watchMessageTransform } from '../../stampedTransform';
import {
  cameraPlaneCorners,
  matchCameraInfo,
  PendingCameraInfoError,
  type CameraCalibration,
} from '../../images/cameraCalibration';
import { normalizeCameraImageOptions, type CameraImageOptions } from '../../images/cameraImageOptions';
import { subscribeToCameraInfo, subscribeToImages, type SharedImageFrame } from '../../images/cameraStreams';

type Candidate = {
  frame: SharedImageFrame;
  release: () => void;
  stopTf?: () => void;
  projection?: { key: string; corners: number[][] };
  result?: TransformResult;
  fixedFrame?: string;
  error: string | null;
  waiting: boolean;
  expired?: boolean;
  deadline?: ReturnType<typeof setTimeout>;
};
const FRAME_WAIT_MS = 2000;
const STATUS_GRACE_MS = 500;

export class CameraImageClient {
  readonly object = new THREE.Group();
  readonly plane = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  readonly frustum = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, toneMapped: false })
  );
  private options = normalizeCameraImageOptions();
  private frame: SharedImageFrame | null = null;
  private textureFrame: SharedImageFrame | null = null;
  private samples: readonly CameraCalibration[] = [];
  private infoError: string | null = null;
  private imageError: string | null = null;
  private projectionKey = '';
  // Retain the oldest unresolved frame and the newest frame. Replacing the only
  // pending frame on every image would starve rendering when TF lags the camera.
  private candidates: Candidate[] = [];
  private displayed?: Candidate;
  private displayedFixedFrame?: string;
  private preparing = false;
  private waitTimer?: ReturnType<typeof setTimeout>;
  private waitExpired = false;
  private lastStatus: string | null | undefined;
  private stopImages?: () => void;
  private stopInfo?: () => void;
  private disposed = false;

  constructor(
    private config: {
      ros: Ros;
      topic: string;
      messageType: string;
      tfClient: CustomTFProvider;
      rootObject: THREE.Object3D;
      requestRender: () => void;
      onStatus?: (status: string | null) => void;
      options?: CameraImageOptions;
      maxTextureSize?: number;
    }
  ) {
    this.object.name = `Camera image: ${config.topic}`;
    this.object.visible = false;
    this.object.add(this.plane, this.frustum);
    config.rootObject.add(this.object);
    this.updateOptions(config.options);
    this.stopImages = subscribeToImages(config.ros, config.topic, config.messageType, event => {
      if (this.disposed) return;
      this.frame = event.frame;
      this.imageError = event.error;
      this.refresh();
    });
  }

  updateOptions(options: CameraImageOptions = {}) {
    if (this.disposed) return;
    const previous = this.options;
    this.options = normalizeCameraImageOptions(options, this.config.topic);
    if (
      previous.cameraInfoTopic !== this.options.cameraInfoTopic ||
      previous.imageGeometry !== this.options.imageGeometry ||
      previous.calibrationSync !== this.options.calibrationSync ||
      previous.toleranceMs !== this.options.toleranceMs
    )
      this.resetSnapshots();
    this.plane.material.opacity = this.options.opacity;
    this.frustum.visible = this.options.showFrustum;
    if (previous.cameraInfoTopic !== this.options.cameraInfoTopic) {
      this.stopInfo?.();
      this.stopInfo = undefined;
      this.samples = [];
      this.infoError = null;
      if (this.options.cameraInfoTopic)
        this.stopInfo = subscribeToCameraInfo(this.config.ros, this.options.cameraInfoTopic, event => {
          if (this.disposed) return;
          this.samples = event.samples;
          this.infoError = event.error;
          this.refresh();
        });
    }
    this.refresh();
    this.config.requestRender();
  }

  private releaseCandidate(candidate: Candidate) {
    candidate.stopTf?.();
    clearTimeout(candidate.deadline);
    candidate.release();
  }

  private clearWait() {
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    this.waitExpired = false;
  }

  private resetSnapshots() {
    this.candidates.forEach(candidate => this.releaseCandidate(candidate));
    this.candidates = [];
    if (this.displayed) this.releaseCandidate(this.displayed);
    this.displayed = undefined;
    this.clearTexture();
    this.clearWait();
    this.displayedFixedFrame = undefined;
    if (this.object.visible) this.config.requestRender();
    this.object.visible = false;
  }

  private showState(error: string | null, waiting = false) {
    const held = !!this.displayed && this.displayedFixedFrame === this.config.tfClient.fixedFrame;
    const visible = held && this.options.visible;
    if (this.object.visible !== visible) {
      this.object.visible = visible;
      this.config.requestRender();
    }
    if (waiting && held) {
      if (!this.waitTimer) {
        this.waitTimer = setTimeout(() => {
          this.waitExpired = true;
          this.settle();
        }, STATUS_GRACE_MS);
      }
      error = this.waitExpired ? `Showing last valid image (stale). ${error}` : null;
    } else this.clearWait();
    if (error !== this.lastStatus) {
      this.lastStatus = error;
      this.config.onStatus?.(error);
    }
  }

  private isOlderThanDisplay(frame: SharedImageFrame) {
    const displayed = this.displayed?.frame;
    const stamp = rosStamp(frame.header?.stamp);
    const previous = rosStamp(displayed?.header?.stamp);
    return (
      !!displayed &&
      frame.header?.frame_id === displayed.header?.frame_id &&
      stamp !== null &&
      previous !== null &&
      stamp > 0n &&
      previous > 0n &&
      stamp < previous
    );
  }

  private refresh() {
    if (this.disposed) return;
    const error =
      this.imageError ||
      this.infoError ||
      (!this.options.cameraInfoTopic ? 'Select the matching CameraInfo topic for this image.' : null);
    if (error || !this.frame) {
      this.resetSnapshots();
      this.showState(error || 'Waiting for camera image messages.');
      return;
    }
    if (this.isOlderThanDisplay(this.frame)) return;
    while (this.candidates[0]?.expired && this.candidates[0].frame !== this.frame) {
      this.releaseCandidate(this.candidates.shift()!);
    }
    if (!this.candidates.some(candidate => candidate.frame === this.frame)) {
      if (this.candidates.length === 2) this.releaseCandidate(this.candidates.pop()!);
      const sameSnapshot = this.displayed?.frame === this.frame ? this.displayed : undefined;
      const candidate: Candidate = {
        frame: this.frame,
        release: this.frame.retain(),
        error: null,
        waiting: false,
        result: sameSnapshot?.result,
        fixedFrame: sameSnapshot?.fixedFrame,
      };
      this.candidates.push(candidate);
      candidate.deadline = setTimeout(() => {
        if (this.disposed) return;
        candidate.expired = true;
        if (this.candidates[0] === candidate && this.candidates.length > 1) this.refresh();
      }, FRAME_WAIT_MS);
    }
    this.preparing = true;
    for (const candidate of this.candidates) {
      try {
        if (/compresseddepth/i.test(candidate.frame.encoding))
          throw new Error('Compressed depth is unsupported in this layer. Select a color or mono image topic.');
        const calibration = matchCameraInfo(
          this.samples,
          candidate.frame.header,
          this.options.calibrationSync,
          this.options.toleranceMs
        );
        const { width, height } = candidate.frame.image;
        if (Math.max(width, height) > (this.config.maxTextureSize ?? 8192))
          throw new Error('Image exceeds this GPU’s texture size limit.');
        const key = JSON.stringify([
          calibration.k,
          calibration.p,
          calibration.r,
          calibration.d,
          calibration.distortionModel,
          calibration.roi,
          calibration.width,
          calibration.height,
          calibration.binningX,
          calibration.binningY,
          width,
          height,
          this.options.imageGeometry,
          this.options.distance,
        ]);
        if (candidate.projection?.key !== key) {
          const corners = cameraPlaneCorners(
            calibration,
            width,
            height,
            this.options.imageGeometry,
            this.options.distance
          );
          if (!corners.flat().every(v => Number.isFinite(Math.fround(v))))
            throw new Error('Camera projection exceeds rendering limits.');
          candidate.projection = { key, corners };
        }
        candidate.error = null;
        candidate.waiting = false;
      } catch (error) {
        candidate.projection = undefined;
        candidate.error = error instanceof Error ? error.message : 'Camera image cannot be projected.';
        candidate.waiting = error instanceof PendingCameraInfoError;
      }
      if (!candidate.stopTf) {
        candidate.stopTf = watchMessageTransform(this.config.tfClient, candidate.frame.header, result => {
          if (this.disposed) return;
          const fixedFrame = this.config.tfClient.fixedFrame;
          // A displayed image is an acquisition-time snapshot. Later TF refinements
          // must not move it independently of its pixels, including zero-stamp images.
          const held = candidate === this.displayed || candidate.frame === this.displayed?.frame;
          if (!held || !candidate.result?.transform || candidate.fixedFrame !== fixedFrame) {
            candidate.result = result;
            candidate.fixedFrame = fixedFrame;
          }
          if (!this.preparing) this.settle();
        });
      }
    }
    this.preparing = false;
    this.settle();
  }

  private settle() {
    if (this.disposed) return;
    this.candidates = this.candidates.filter(candidate => {
      if (!this.isOlderThanDisplay(candidate.frame)) return true;
      this.releaseCandidate(candidate);
      return false;
    });
    const newest = this.candidates[this.candidates.length - 1];
    if (newest?.error && !newest.waiting) {
      // Invalid data must fail closed; only temporarily missing data can hold an old image.
      if (this.displayed) this.releaseCandidate(this.displayed);
      this.displayed = undefined;
      this.clearTexture();
      this.showState(newest.error);
      return;
    }
    const ready = [...this.candidates]
      .reverse()
      .find(
        candidate =>
          candidate.projection &&
          candidate.result?.transform &&
          candidate.fixedFrame === this.config.tfClient.fixedFrame
      );
    if (ready) {
      const index = this.candidates.indexOf(ready);
      this.candidates.splice(0, index + 1).forEach(candidate => {
        if (candidate !== ready) this.releaseCandidate(candidate);
      });
      if (this.displayed) this.releaseCandidate(this.displayed);
      this.displayed = ready;
      clearTimeout(ready.deadline);
      this.updateGeometry(ready.projection!);
      if (this.textureFrame !== ready.frame) this.updateTexture(ready.frame);
      this.clearWait();
      this.config.requestRender();
    }
    const displayed = this.displayed;
    if (displayed?.result?.transform && displayed.fixedFrame === this.config.tfClient.fixedFrame) {
      const { translation, rotation } = displayed.result.transform;
      const moved = !this.object.position.equals(translation) || !this.object.quaternion.equals(rotation);
      this.displayedFixedFrame = displayed.fixedFrame;
      this.object.position.copy(translation);
      this.object.quaternion.copy(rotation);
      if (moved) this.config.requestRender();
    }
    // A missing historical TF sample does not invalidate an already resolved pose in
    // the same fixed frame. A fixed-frame change does invalidate those coordinates.
    const pending = this.candidates[this.candidates.length - 1];
    const waiting = !!pending || (!!displayed && this.displayedFixedFrame !== this.config.tfClient.fixedFrame);
    this.showState(
      waiting ? pending?.error || pending?.result?.error || 'Waiting for TF at image time.' : null,
      waiting
    );
  }

  private updateGeometry({ key, corners }: { key: string; corners: number[][] }) {
    if (key === this.projectionKey) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    // Both raw RGBA and decoded bitmaps start at the top row; do not flip the texture.
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeBoundingSphere();
    this.plane.geometry.dispose();
    this.plane.geometry = geometry;
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...corners.flat()], 3));
    lines.setIndex([0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1]);
    lines.computeBoundingSphere();
    this.frustum.geometry.dispose();
    this.frustum.geometry = lines;
    this.projectionKey = key;
  }

  private updateTexture(frame: SharedImageFrame) {
    const image = frame.image;
    const raw = 'data' in image;
    let texture = this.plane.material.map;
    const sameSize = texture?.image?.width === image.width && texture?.image?.height === image.height;
    if (!texture || !sameSize || texture instanceof THREE.DataTexture !== raw) {
      texture?.dispose();
      texture = raw
        ? new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat)
        : new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      this.plane.material.map = texture;
      this.plane.material.needsUpdate = true;
    } else if (raw) texture.image.data = image.data;
    else texture.image = image;
    texture.needsUpdate = true;
    this.textureFrame = frame;
  }
  private clearTexture() {
    this.plane.material.map?.dispose();
    this.plane.material.map = null;
    this.textureFrame = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopImages?.();
    this.stopInfo?.();
    this.resetSnapshots();
    this.frame = null;
    this.samples = [];
    this.object.removeFromParent();
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.frustum.geometry.dispose();
    this.frustum.material.dispose();
    this.config.requestRender();
  }
}
