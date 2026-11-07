import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshOpacity } from './meshOpacity';

it('preserves multi-material alpha, render state and textures across repeated layer changes', () => {
  const texture = new THREE.Texture();
  const opaque = new THREE.MeshBasicMaterial({ map: texture });
  const glass = new THREE.MeshBasicMaterial({ opacity: 0.6, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [opaque, glass]);
  const opacity = new MeshOpacity();
  opacity.set(0.5, mesh);
  expect([opaque.opacity, glass.opacity]).toEqual([0.5, 0.3]);
  expect(opaque.depthWrite).toBe(false);
  opacity.set(0.25, mesh);
  expect([opaque.opacity, glass.opacity]).toEqual([0.25, 0.15]);
  opacity.set(0, mesh);
  expect(opaque.opacity).toBe(0);
  opacity.set(1, mesh);
  expect(opaque).toMatchObject({ opacity: 1, transparent: false, depthWrite: true, map: texture });
  expect(glass).toMatchObject({ opacity: 0.6, transparent: true, depthWrite: false });
  mesh.geometry.dispose();
  opaque.dispose();
  glass.dispose();
  texture.dispose();
});

it('uses current opacity for late objects and leaves independent layers unchanged', () => {
  const a = new MeshOpacity(),
    b = new MeshOpacity();
  const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const second = new THREE.Mesh(first.geometry, new THREE.MeshBasicMaterial());
  a.set(0.4);
  a.apply(first);
  b.apply(second);
  expect(first.material.opacity).toBe(0.4);
  expect(second.material.opacity).toBe(1);
  a.set(Number.NaN, first);
  expect(first.material.opacity).toBe(1);
  a.set(-1, first);
  expect(first.material.opacity).toBe(0);
  first.geometry.dispose();
  first.material.dispose();
  second.material.dispose();
});
