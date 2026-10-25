import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Axes } from './ros3d';

describe('solid TF axes', () => {
  it('renders independent length and diameter with RGB colors in one draw object', () => {
    const axes = new Axes({ lineSize: 0.4, shaftRadius: 0.004 });
    expect(axes.children).toHaveLength(1);
    const mesh = axes.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.material.vertexColors).toBe(true);
    const positions = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    const bounds = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3()];
    for (let i = 0; i < positions.count; i++) {
      const axis = colors.getX(i) === 1 ? 0 : colors.getY(i) === 1 ? 1 : 2;
      bounds[axis].expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i));
    }
    bounds.forEach((box, axis) => {
      expect(box.min.getComponent(axis)).toBeCloseTo(0);
      expect(box.max.getComponent(axis)).toBeCloseTo(0.4);
      for (const other of [0, 1, 2].filter(value => value !== axis)) {
        expect(box.max.getComponent(other) - box.min.getComponent(other)).toBeCloseTo(0.008);
      }
    });
    expect(axes.lineSegments?.geometry).toBe(mesh.geometry);
    expect(axes.lineSegments?.material).toBe(mesh.material);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('preserves the original line axes for consumers that do not specify width', () => {
    const axes = new Axes({ lineSize: 0.2 });
    expect(axes.children[0]).toBeInstanceOf(THREE.AxesHelper);
    axes.lineSegments?.geometry?.dispose();
    (axes.lineSegments?.material as THREE.Material).dispose();
  });
});
