import type * as THREE from 'three';

export interface MeshDisplayOptions {
  opacity?: number;
}
export const normalizeMeshOpacity = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

/** Per-layer multiplier. Preserve authored alpha and restore the original render state at 100%. */
export class MeshOpacity {
  private value = 1;
  private originals = new WeakMap<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();

  set(value: unknown, root?: THREE.Object3D) {
    this.value = normalizeMeshOpacity(value);
    if (root) this.apply(root);
  }

  apply(root: THREE.Object3D) {
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        let original = this.originals.get(material);
        if (!original) {
          original = { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
          this.originals.set(material, original);
        }
        const opacity = original.opacity * this.value;
        const transparent = original.transparent || this.value < 1;
        if (material.transparent !== transparent) material.needsUpdate = true;
        material.opacity = opacity;
        material.transparent = transparent;
        material.depthWrite = this.value < 1 ? false : original.depthWrite;
      }
    });
  }
}
