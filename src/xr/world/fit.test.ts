import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeMeshBounds, fitBoundsToStage, VIEW_SCALE_LIMITS } from './fit';

const box = (size: [number, number, number], at: [number, number, number]) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  mesh.position.set(...at);
  return mesh;
};

describe('computeMeshBounds', () => {
  it('unions visible meshes in the space frame and ignores points, lines and hidden meshes', () => {
    const space = new THREE.Group();
    space.scale.setScalar(2);
    const root = new THREE.Group();
    space.add(root);
    root.add(box([1, 1, 1], [0, 0, 0]));
    const hidden = box([50, 50, 50], [0, 0, 0]);
    hidden.visible = false;
    root.add(hidden);
    root.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(90, 0, 0)])));
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 90, 0), new THREE.Vector3()])));

    const bounds = computeMeshBounds(root, space)!;
    // The space is scaled 2x, but bounds are expressed in the space's own units.
    expect(bounds.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(bounds.max.toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  it('reports null when there is nothing solid to measure', () => {
    const root = new THREE.Group();
    expect(computeMeshBounds(root, root)).toBeNull();
  });
});

describe('fitBoundsToStage', () => {
  const stage = { radius: 0.35, height: 0.6 };

  it('stands the content on the floor and centres its footprint', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(1, 0.2, -1), new THREE.Vector3(1.4, 0.6, -0.6));
    const fit = fitBoundsToStage(bounds, stage);
    const bottom = fit.position[1];
    expect(bottom).toBeCloseTo(-0.2 * fit.scale);
    expect(fit.position[0]).toBeCloseTo(-1.2 * fit.scale);
    expect(fit.position[2]).toBeCloseTo(0.8 * fit.scale);
    expect(fit.restY).toBeCloseTo(-0.2);
  });

  it('is limited by whichever of footprint and height is tighter', () => {
    const tall = fitBoundsToStage(new THREE.Box3(new THREE.Vector3(-0.05, 0, -0.05), new THREE.Vector3(0.05, 3, 0.05)), stage);
    expect(tall.scale).toBeCloseTo((stage.height * 0.85) / 3);
    const wide = fitBoundsToStage(new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 0.1, 2)), stage);
    expect(wide.scale).toBeCloseTo((stage.radius * 0.85) / Math.hypot(4, 4) * 2);
  });

  it('clamps degenerate content instead of producing an unbounded scale', () => {
    const flat = fitBoundsToStage(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()), stage);
    expect(flat.scale).toBe(VIEW_SCALE_LIMITS.max);
  });
});
