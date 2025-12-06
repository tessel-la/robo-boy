// Axes implementation - Scene primitive for coordinate axes display
import * as THREE from 'three';

/**
 * Axes helper that extends Object3D for scene integration.
 * Displays XYZ coordinate axes.
 */
export class Axes extends THREE.Object3D {
    lineSegments?: { geometry: THREE.BufferGeometry | null; material: THREE.Material | THREE.Material[] | null; };

    constructor(options: {
        lineType?: string;
        lineSize?: number;
        shaftRadius?: number;
        headRadius?: number;
        headLength?: number;
    } = {}) {
        super();

        const size = options.lineSize || 1;
        const axesHelper = new THREE.AxesHelper(size);
        this.add(axesHelper);

        // Store for disposal if needed
        this.lineSegments = {
            geometry: axesHelper.geometry,
            material: axesHelper.material
        };
    }
}
