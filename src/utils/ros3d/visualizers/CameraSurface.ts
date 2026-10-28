import * as THREE from 'three';
import type { Viewer } from '../../ros3d';
import type { CustomTFProvider } from '../../tfUtils';
import { rosStamp } from '../../rosTime';
import { normalizeCameraImageOptions, type CameraImageOptions } from '../../images/cameraImageOptions';
import type { CameraImageClient } from './CameraImage';

import { cameraClipMatrix } from '../../images/cameraProjectionMatrix';

type Surface = { mesh: THREE.Mesh; layer: string; frame?: THREE.Object3D };
export function cameraSurfaces(scene: THREE.Object3D): Surface[] {
  const surfaces: Surface[] = [];
  scene.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh) || surfaces.length >= 4096 || !object.geometry.getAttribute('position')) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(material => material.visible && material.opacity > 0)) return;
    let layer: string | undefined, frame: THREE.Object3D | undefined;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      frame ??= parent.userData.projectionFrame ? parent : undefined;
      if (typeof parent.userData.projectionLayer === 'string') {
        layer = parent.userData.projectionLayer;
        break;
      }
    }
    if (layer) surfaces.push({ mesh: object, layer, frame });
  });
  return surfaces;
}

const vertexShader = `
  uniform mat4 imageWorld;
  uniform mat4 projector;
  varying vec4 projected;
  varying vec3 imagePoint;
  varying vec2 surfaceUv;
  void main() {
    surfaceUv = uv;
    vec4 captured = imageWorld * vec4(position, 1.0);
    imagePoint = captured.xyz;
    projected = projector * captured;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const fragmentShader = `
  uniform sampler2D image;
  uniform sampler2D sceneDepth;
  uniform float opacity;
  uniform vec3 projectorPosition;
  uniform float maximumRange;
  uniform sampler2D surfaceMap;
  uniform sampler2D surfaceAlpha;
  uniform mat3 mapTransform;
  uniform mat3 alphaTransform;
  uniform float alphaTest;
  varying vec4 projected;
  varying vec3 imagePoint;
  varying vec2 surfaceUv;
  void main() {
    if (projected.w <= 0.0) discard;
    if (distance(imagePoint, projectorPosition) > maximumRange) discard;
    vec3 p = projected.xyz / projected.w * 0.5 + 0.5;
    if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) discard;
    if (p.z > texture2D(sceneDepth, p.xy).x + 0.0001) discard;
    float coverage = texture2D(surfaceMap, (mapTransform * vec3(surfaceUv, 1.0)).xy).a;
    coverage *= texture2D(surfaceAlpha, (alphaTransform * vec3(surfaceUv, 1.0)).xy).g;
    if (coverage < alphaTest) discard;
    gl_FragColor = texture2D(image, vec2(p.x, 1.0 - p.y));
    gl_FragColor.a *= opacity * coverage;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
type Entry = {
  overlay: THREE.Mesh;
  depth: THREE.Mesh;
  shaders: THREE.ShaderMaterial[];
  originals: THREE.Material[];
  depthMaterials: THREE.MeshDepthMaterial[];
  geometryVersion?: number;
  maskVersions?: number[];
};
const disposeEntry = (entry: Entry) => {
  entry.overlay.removeFromParent();
  entry.depth.removeFromParent();
  entry.shaders.forEach(material => material.dispose());
  entry.depthMaterials.forEach(material => material.dispose());
};

/** Viewer-owned GPU overlay. Mesh geometry and the camera texture are borrowed, never replaced/disposed. */
export class CameraSurfaceProjection {
  private overlays = new THREE.Scene();
  private depths = new THREE.Scene();
  private entries = new Map<THREE.Mesh, Entry>();
  private white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private camera = new THREE.Camera();
  private target?: THREE.WebGLRenderTarget;
  private options = normalizeCameraImageOptions();
  private frame?: unknown;
  private framesKey = '';
  private frameMatrices = new Map<string, THREE.Matrix4>();
  private stopTf?: () => void;
  private remove: () => void;
  private disposed = false;
  private status: string | null = null;
  private depthDirty = true;
  private lastProjector = new THREE.Matrix4();
  constructor(
    private viewer: Viewer,
    private source: CameraImageClient,
    private provider: CustomTFProvider,
    private onStatus: (status: string | null) => void
  ) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.white.needsUpdate = true;
    this.remove = viewer.addOverlay(this);
  }
  updateOptions(options: CameraImageOptions) {
    const previous = this.options.renderMode;
    this.options = normalizeCameraImageOptions(options);
    if (previous === 'surfaces' && this.options.renderMode === 'plane') this.clear();
  }
  private report(status: string | null) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }
  render = () => {
    if (this.disposed) return;
    const snapshot = this.source.getSnapshot().displayed;
    const options = this.options;
    if (options.renderMode !== 'surfaces' || !options.visible || !snapshot || !this.source.object.visible) {
      this.report(null);
      return;
    }
    if (!options.surfaceTargets.length) {
      this.report('Select the URDF or mesh layers receiving this projection.');
      return;
    }
    const stamp = rosStamp(snapshot.frame.header?.stamp) ?? 0n;
    if (options.surfaceTiming === 'image' && stamp === 0n) {
      this.report(
        'Image-time surfaces require an acquisition timestamp and capture-time camera TF. Select Capture time/ROS images, or Latest scene explicitly.'
      );
      return;
    }
    const surfaces = cameraSurfaces(this.viewer.scene);
    const frameNames = [
      ...new Set(surfaces.map(surface => surface.frame?.userData.projectionFrame as string).filter(Boolean)),
    ].sort();
    const key = JSON.stringify([options.surfaceTiming, snapshot.fixedFrame, frameNames]);
    if (this.frame !== snapshot.frame || key !== this.framesKey) {
      this.stopTf?.();
      this.stopTf = undefined;
      this.frame = snapshot.frame;
      this.framesKey = key;
      this.frameMatrices.clear();
      if (options.surfaceTiming === 'image')
        this.stopTf = this.provider.watchTransforms(
          frameNames.map(frameId => ({ frameId, stamp })),
          results => {
            results.forEach((result, index) => {
              if (result.transform && !this.frameMatrices.has(frameNames[index]))
                this.frameMatrices.set(
                  frameNames[index],
                  new THREE.Matrix4().compose(
                    result.transform.translation,
                    result.transform.rotation,
                    new THREE.Vector3(1, 1, 1)
                  )
                );
            });
            if (this.frameMatrices.size === frameNames.length)
              queueMicrotask(() => {
                if (this.framesKey === key && this.frame === snapshot.frame) {
                  this.stopTf?.();
                  this.stopTf = undefined;
                }
              });
            this.viewer.requestRender();
          }
        );
    }
    const active = new Set<THREE.Mesh>();
    let receivers = 0,
      missing = 0;
    for (const surface of surfaces) {
      const { mesh, layer, frame } = surface;
      const receive =
        options.surfaceTargets.includes(layer) &&
        (!options.surfaceLinks.length ||
          options.surfaceLinks.includes(frame?.name ?? '') ||
          options.surfaceLinks.includes(frame?.userData.projectionFrame ?? ''));
      const frameAtImage = frame && this.frameMatrices.get(frame.userData.projectionFrame);
      if (options.surfaceTiming === 'image' && (!frameAtImage || !frame)) {
        missing++;
        continue;
      }
      active.add(mesh);
      let entry = this.entries.get(mesh);
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (
        entry &&
        (originals.length !== entry.originals.length ||
          originals.some((material, index) => material !== entry!.originals[index]))
      ) {
        disposeEntry(entry);
        entry = undefined;
      }
      if (!entry) {
        this.depthDirty = true;
        const shaders = originals.map(
          original =>
            new THREE.ShaderMaterial({
              vertexShader,
              fragmentShader,
              transparent: true,
              depthWrite: false,
              side: original.side,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
              toneMapped: false,
              uniforms: {
                imageWorld: { value: new THREE.Matrix4() },
                projector: { value: new THREE.Matrix4() },
                image: { value: null },
                sceneDepth: { value: null },
                opacity: { value: 1 },
                projectorPosition: { value: new THREE.Vector3() },
                maximumRange: { value: 20 },
                surfaceMap: { value: this.white },
                surfaceAlpha: { value: this.white },
                mapTransform: { value: new THREE.Matrix3() },
                alphaTransform: { value: new THREE.Matrix3() },
                alphaTest: { value: 0 },
              },
            })
        );
        const depthMaterials = originals.map(original => new THREE.MeshDepthMaterial({ side: original.side }));
        const overlay = new THREE.Mesh(mesh.geometry, Array.isArray(mesh.material) ? shaders : shaders[0]);
        const depth = new THREE.Mesh(mesh.geometry, Array.isArray(mesh.material) ? depthMaterials : depthMaterials[0]);
        overlay.matrixAutoUpdate = depth.matrixAutoUpdate = false;
        overlay.frustumCulled = depth.frustumCulled = false;
        this.overlays.add(overlay);
        this.depths.add(depth);
        this.entries.set(mesh, (entry = { overlay, depth, shaders, depthMaterials, originals }));
      }
      const imageWorld =
        options.surfaceTiming === 'image'
          ? frameAtImage!.clone().multiply(frame!.matrixWorld.clone().invert()).multiply(mesh.matrixWorld)
          : mesh.matrixWorld;
      const attribute = mesh.geometry.getAttribute('position');
      const version = attribute instanceof THREE.BufferAttribute ? attribute.version : attribute.data.version;
      if (
        entry.geometryVersion !== version ||
        entry.depth.geometry !== mesh.geometry ||
        !entry.depth.matrix.equals(imageWorld)
      )
        this.depthDirty = true;
      entry.geometryVersion = version;
      entry.overlay.geometry = entry.depth.geometry = mesh.geometry;
      entry.overlay.matrix.copy(mesh.matrixWorld);
      entry.depth.matrix.copy(imageWorld);
      entry.overlay.visible = receive;
      entry.shaders.forEach((shader, index) => {
        const original = originals[index] as THREE.Material & { map?: THREE.Texture; alphaMap?: THREE.Texture };
        const depth = entry!.depthMaterials[index];
        if (
          depth.map !== (original.map ?? null) ||
          depth.alphaMap !== (original.alphaMap ?? null) ||
          depth.alphaTest !== Math.max(original.alphaTest, 0.001) ||
          depth.side !== original.side
        ) {
          this.depthDirty = true;
          depth.map = original.map ?? null;
          depth.alphaMap = original.alphaMap ?? null;
          depth.alphaTest = Math.max(original.alphaTest, 0.001);
          depth.side = original.side;
          depth.needsUpdate = true;
        }
        const visible = original.visible && original.opacity > 0;
        if (depth.visible !== visible) this.depthDirty = true;
        shader.visible = depth.visible = visible;
        if (shader.side !== original.side) {
          shader.side = original.side;
          shader.needsUpdate = true;
        }
        shader.uniforms.imageWorld.value.copy(imageWorld);
        shader.uniforms.surfaceMap.value = original.map ?? this.white;
        shader.uniforms.surfaceAlpha.value = original.alphaMap ?? this.white;
        shader.uniforms.alphaTest.value = original.alphaTest;
        const maskVersion = (original.map?.version ?? 0) + (original.alphaMap?.version ?? 0);
        if (entry!.maskVersions?.[index] !== maskVersion) this.depthDirty = true;
        (entry!.maskVersions ??= [])[index] = maskVersion;
        for (const [texture, uniform] of [
          [original.map, 'mapTransform'],
          [original.alphaMap, 'alphaTransform'],
        ] as const) {
          if (texture?.matrixAutoUpdate) texture.updateMatrix();
          if (texture && !shader.uniforms[uniform].value.equals(texture.matrix)) this.depthDirty = true;
          shader.uniforms[uniform].value.copy(texture?.matrix ?? new THREE.Matrix3());
        }
      });
      if (receive) receivers++;
    }
    for (const [mesh, entry] of this.entries)
      if (!active.has(mesh)) {
        this.depthDirty = true;
        disposeEntry(entry);
        this.entries.delete(mesh);
      }
    if (missing) {
      this.report('Waiting for scene-mesh TF at image time; occlusion cannot be resolved.');
      return;
    }
    if (!receivers) {
      this.report('No visible meshes match the selected projection targets.');
      return;
    }
    const renderer = this.viewer.renderer;
    if (!this.target) {
      const side = Math.min(1024, renderer.capabilities.maxTextureSize);
      this.target = new THREE.WebGLRenderTarget(side, side, { depthTexture: new THREE.DepthTexture(side, side) });
      this.target.texture.generateMipmaps = false;
    }
    this.camera.matrixWorld.compose(snapshot.position, snapshot.rotation, new THREE.Vector3(1, 1, 1));
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.camera.projectionMatrix.copy(cameraClipMatrix(snapshot.corners, 0.01, options.surfaceRange));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    const projector = this.camera.projectionMatrix.clone().multiply(this.camera.matrixWorldInverse);
    if (!this.lastProjector.equals(projector)) {
      this.depthDirty = true;
      this.lastProjector.copy(projector);
    }
    for (const entry of this.entries.values())
      for (const shader of entry.shaders) {
        const uniforms = shader.uniforms;
        uniforms.projector.value.copy(projector);
        uniforms.image.value = this.source.plane.material.map;
        uniforms.sceneDepth.value = this.target.depthTexture;
        uniforms.opacity.value = options.opacity;
        uniforms.projectorPosition.value.copy(snapshot.position);
        uniforms.maximumRange.value = options.surfaceRange;
      }
    const previousTarget = renderer.getRenderTarget(),
      previousAutoClear = renderer.autoClear;
    const viewport = renderer.getViewport(new THREE.Vector4()),
      scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    try {
      renderer.setScissorTest(false);
      if (this.depthDirty) {
        renderer.setRenderTarget(this.target);
        renderer.autoClear = true;
        renderer.render(this.depths, this.camera);
        this.depthDirty = false;
      }
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.autoClear = false;
      renderer.render(this.overlays, this.viewer.camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.autoClear = previousAutoClear;
    }
    this.report(
      surfaces.length === 4096
        ? 'Surface projection reached the 4096-mesh limit.'
        : options.surfaceTiming === 'latest'
          ? 'Surface projection uses latest scene geometry; not time-synchronized.'
          : null
    );
  };
  private clear() {
    this.stopTf?.();
    this.stopTf = undefined;
    this.entries.forEach(disposeEntry);
    this.entries.clear();
    this.overlays.clear();
    this.depths.clear();
    this.target?.dispose();
    this.target = undefined;
    this.frame = undefined;
    this.framesKey = '';
    this.frameMatrices.clear();
    this.depthDirty = true;
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.remove();
    this.clear();
    this.white.dispose();
    this.viewer.requestRender();
  };
}
