import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Axes, Grid } from './ros3d';

describe('live ROS3D primitives', () => {
  it('creates a Z-up grid with the requested size, divisions, and black colors', () => {
    const grid = new Grid({ size: 20, divisions: 4, colorCenterLine: 0, colorGrid: 0 });
    const helper = grid.children[0] as THREE.GridHelper;
    expect(helper).toBeInstanceOf(THREE.GridHelper);
    expect(helper.rotation.x).toBeCloseTo(Math.PI / 2);
    const positions = helper.geometry.getAttribute('position');
    expect(positions.count).toBe(20);
    expect(positions.getX(0)).toBe(-10);
    expect(positions.getX(1)).toBe(10);
    expect([...helper.geometry.getAttribute('color').array]).toEqual(Array(60).fill(0));
    helper.geometry.dispose();
    for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) material.dispose();
  });

  it('retains grid defaults', () => {
    const helper = new Grid().children[0] as THREE.GridHelper;
    expect(helper.geometry.getAttribute('position').count).toBe(44);
    expect(helper.geometry.getAttribute('position').getX(0)).toBe(-5);
    helper.geometry.dispose();
    for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) material.dispose();
  });

  it.each([undefined, 5])('exposes the actual axis resources for disposal (size %s)', size => {
    const axes = new Axes(size === undefined ? {} : { lineSize: size });
    const helper = axes.children[0] as THREE.AxesHelper;
    expect(helper).toBeInstanceOf(THREE.AxesHelper);
    expect(helper.geometry.getAttribute('position').getX(1)).toBe(size ?? 1);
    expect(axes.lineSegments?.geometry).toBe(helper.geometry);
    expect(axes.lineSegments?.material).toBe(helper.material);
    helper.geometry.dispose();
    for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) material.dispose();
  });
});
