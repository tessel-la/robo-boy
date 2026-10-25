import * as THREE from 'three';
import type { Ros } from 'roslib';
import type { CustomTFProvider } from '../../tfUtils';
import { watchMessageTransform } from '../../stampedTransform';
import { cameraPlaneCorners, matchCameraInfo, type CameraCalibration } from '../../images/cameraCalibration';
import { normalizeCameraImageOptions, type CameraImageOptions } from '../../images/cameraImageOptions';
import { subscribeToCameraInfo, subscribeToImages } from '../../images/cameraStreams';
import type { DecodedImageFrame } from '../../images/decodeImage';

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
  private frame: DecodedImageFrame | null = null;
  private textureFrame: DecodedImageFrame | null = null;
  private samples: readonly CameraCalibration[] = [];
  private infoError: string | null = null;
  private imageError: string | null = null;
  private projectionKey = '';
  private transformKey = '';
  private projectionValid = false;
  private tfValid = false;
  private tfError: string | null = null;
  private projectionError: string | null = 'Waiting for camera image messages.';
  private stopImages?: () => void;
  private stopInfo?: () => void;
  private stopTf?: () => void;
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
      if (!event.frame) {
        this.clearTexture();
        this.stopTf?.();
        this.stopTf = undefined;
        this.transformKey = '';
        this.tfValid = false;
      }
      this.refresh();
    });
  }

  updateOptions(options: CameraImageOptions = {}) {
    if (this.disposed) return;
    const previous = this.options;
    this.options = normalizeCameraImageOptions(options, this.config.topic);
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

  private showState() {
    const visible = this.projectionValid && this.tfValid && this.options.visible;
    if (this.object.visible !== visible) {
      this.object.visible = visible;
      this.config.requestRender();
    }
    this.config.onStatus?.(this.projectionValid ? this.tfError : this.projectionError);
  }

  private refresh() {
    if (this.disposed) return;
    try {
      if (this.imageError) throw new Error(this.imageError);
      if (!this.options.cameraInfoTopic) throw new Error('Select the matching CameraInfo topic for this image.');
      if (this.infoError) throw new Error(this.infoError);
      if (!this.frame) throw new Error('Waiting for camera image messages.');
      if (/compresseddepth/i.test(this.frame.encoding))
        throw new Error('Compressed depth is unsupported in this layer. Select a color or mono image topic.');
      const calibration = matchCameraInfo(
        this.samples,
        this.frame.header,
        this.options.calibrationSync,
        this.options.toleranceMs
      );
      const { width, height } = this.frame.image;
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
      if (key !== this.projectionKey) {
        const corners = cameraPlaneCorners(
          calibration,
          width,
          height,
          this.options.imageGeometry,
          this.options.distance
        );
        if (!corners.flat().every(v => Number.isFinite(Math.fround(v))))
          throw new Error('Camera projection exceeds rendering limits.');
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
        this.config.requestRender();
      }
      if (this.textureFrame !== this.frame) this.updateTexture(this.frame);
      this.projectionValid = true;
      this.projectionError = null;
      const header = this.frame.header!;
      const transformKey = JSON.stringify(header);
      if (this.transformKey !== transformKey) {
        this.stopTf?.();
        this.tfValid = false;
        this.tfError = 'Waiting for TF at image time.';
        this.transformKey = transformKey;
        this.stopTf = watchMessageTransform(this.config.tfClient, header, result => {
          if (this.disposed) return;
          const moved =
            !!result.transform &&
            (!this.object.position.equals(result.transform.translation) ||
              !this.object.quaternion.equals(result.transform.rotation));
          this.tfValid = !!result.transform;
          this.tfError = result.error;
          if (result.transform) {
            this.object.position.copy(result.transform.translation);
            this.object.quaternion.copy(result.transform.rotation);
          }
          this.showState();
          if (moved && this.object.visible) this.config.requestRender();
        });
      }
    } catch (error) {
      this.projectionValid = false;
      this.projectionError = error instanceof Error ? error.message : 'Camera image cannot be projected.';
    }
    this.showState();
  }

  private updateTexture(frame: DecodedImageFrame) {
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
    this.config.requestRender();
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
    this.stopTf?.();
    this.clearTexture();
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
